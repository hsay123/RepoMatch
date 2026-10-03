# RepoMatch — Backend

Tinder-style open-source repository discovery. Searches GitHub for repos that
match a developer's skills and interests, then uses a **locally hosted Gemma
model** (via Ollama) to score each one and pick the single best starter issue.

- JavaScript (ES modules), Node 18+, Express
- No database, no auth, no cloud LLM APIs — everything AI runs on your laptop
- Works with or without a GitHub token (falls back to demo data when rate limited)

---

## 1. Setup

```bash
cd backend
npm install
cp .env.example .env      # then paste a GitHub token if you have one
ollama pull gemma4:e2b   # one-time, ~3.5 GB
npm run dev               # nodemon, restarts on save
```

Production / no-watch:

```bash
npm start
```

The server prints its port, whether `GITHUB_TOKEN` is set, and the Gemma health
status on boot.

### Exact install commands

```bash
cd backend
npm install express cors dotenv
npm install --save-dev nodemon
```

(`npm install` from the provided `package.json` does the same thing.)

---

## 2. File layout

```
backend/
├── services/
│   ├── config.js          all tunables + env reading (one place to change things)
│   ├── githubService.js   GitHub REST: search, issues, normalisation, TTL cache
│   ├── gemmaService.js    Ollama: health, prompts, JSON parsing, validation
│   ├── matchingService.js deterministic pre-filter (0-100 rubric)
│   └── demoData.js        8 offline repos used when GitHub fails
├── routes/
│   └── matchRoutes.js     POST /api/matches pipeline + response cache
├── server.js              app wiring, CORS, health route, error handler
├── package.json
├── .env.example
└── .gitignore
```

---

## 3. API

### `GET /api/health`

```bash
curl http://localhost:3000/api/health
```

```json
{ "status": "ok", "gemma": true, "ollama": true, "model": "gemma4:e2b" }
```

`gemma` is `true` only when Ollama answers `GET /api/tags` **and** that list
contains a model whose name starts with `gemma4:e2b`.

> The `POST /api/matches` body carries the developer profile, so there is no
> way to pre-validate a profile on the server. The frontend should call
> `/api/health` on mount and disable the match button with a helpful banner when
> `gemma` is `false`.

### `POST /api/matches`

```bash
curl -X POST http://localhost:3000/api/matches \
  -H 'Content-Type: application/json' \
  -d '{
    "skills": ["React", "JavaScript", "Node.js"],
    "interests": ["AI", "Web Development"],
    "experience": "intermediate"
  }'
```

```jsonc
{
  "repositories": [
    {
      "id": 123456,
      "name": "repo-name",
      "fullName": "owner/repo-name",
      "owner": "owner",
      "description": "…",
      "url": "https://github.com/owner/repo-name",
      "stars": 1420,
      "forks": 96,
      "language": "TypeScript",
      "topics": ["typescript", "developer-tools"],
      "goodFirstIssueCount": 3,
      "matchScore": 87,                       // 0-100, produced by Gemma
      "whyMatch": ["…", "…", "…"],
      "recommendedIssue": {
        "title": "Add AVIF output format to the encode() helper",
        "number": 412,
        "url": "https://github.com/owner/repo-name/issues/412",
        "difficulty": "Beginner",             // Beginner | Intermediate | Advanced
        "skills": ["TypeScript", "Testing"]
      },
      "summary": "…"
    }
  ],
  "meta": {
    "dataSource": "github",                   // "github" | "demo"
    "aiSource": "gemma",                      // "gemma" | "fallback"
    "cached": false                           // true on a repeat within 10 min
  }
}
```

Sorted by `matchScore` descending.

**First call takes 30-90 s** (5 sequential local model calls). Subsequent calls
with the same profile return in ~1 ms from the cache, and `meta.cached` is `true`.

### Errors

Always `{"error": string, "code": string}`:

| Status | Code | When |
| --- | --- | --- |
| 400 | `INVALID_PROFILE` | `skills` missing or empty, or bad `experience` |
| 400 | `INVALID_JSON` | body is not parseable JSON |
| 404 | `NOT_FOUND` | unknown `/api/*` path |
| 503 | `GEMMA_UNAVAILABLE` | Ollama down or `gemma4:e2b` not installed |
| 500 | `INTERNAL_ERROR` | anything unexpected |

`429 GITHUB_RATE_LIMIT` is **never** returned to the client. On any GitHub
failure or rate limit the server silently switches to `demoData.js` and sets
`meta.dataSource = "demo"`.

### `DELETE /api/cache` (dev convenience)

```bash
curl -X DELETE http://localhost:3000/api/cache
```

Clears the in-memory response + GitHub search caches.

---

## 4. How the pipeline works

```
validate
  -> cache lookup (10 min, keyed by normalised profile)
  -> checkGemma()                     -> 503 if unavailable (fails in ~100 ms)
  -> searchRepositories()             3 parallel /search calls, merged + deduped, ~15 repos
  -> attachGoodFirstIssues()          top 8 candidates, 3 at a time
  -> pickTopCandidates()              deterministic pre-filter, top 5
  -> analyzeRepositoriesSequential()  one /api/chat call at a time
  -> drop repos with zero good-first issues
  -> merge into the client shape, sort by matchScore desc
  -> cache for 10 min, respond
```

### Why the search query has only one topic

GitHub **ANDs** repeated `topic:` qualifiers. Verified against the live API:

```
language:JavaScript topic:artificial-intelligence topic:web good-first-issues:>0  ->  0 results
language:JavaScript good-first-issues:>0                                          ->  643 results
topic:web good-first-issues:>0                                                    ->  89 results
```

So `githubService` runs **one search per language and per topic** and takes the
union at merge time. The deterministic pre-filter supplies the precision.

### Deterministic pre-filter (0-100, not shown to the user)

| Signal | Points |
| --- | --- |
| skill / language match | 30 |
| topic / interest match | 25 |
| has good-first issues | 20 |
| recently active / has open issues | 10 |
| star range fits experience | 15 |

Star ranges: beginner 50-5k, intermediate 50-20k, advanced any.

Gemma's `matchScore` is the only score the user sees. The pre-filter exists
purely to avoid spending 15 s of local inference on a bad candidate.

### Gemma prompt

`POST /api/chat` with `model: gemma4:e2b`, `stream: false`, `format: "json"`,
`think: false`, `temperature: 0.2`, plus a system prompt that demands
JSON-only output with no reasoning. The user prompt contains the profile, the
repo summary, and a numbered issue list, then asks for exactly:

```json
{ "matchScore": 0, "whyMatch": [], "recommendedIssue": { "number": 0, "difficulty": "", "skills": [] }, "summary": "" }
```

**Safety net after every call** (`validateAnalysis`):
- strips `<think>…</think>` and markdown fences before parsing
- clamps `matchScore` into 0-100
- forces `whyMatch` to be a string array
- **verifies `recommendedIssue.number` against the real issue list**
- takes the issue **title and url from the real issue**, so a hallucinated
  number can never produce a broken link
- falls back to the first real issue, then to a deterministic result

Model reasoning is never read and never returned.

### Fallback behaviour

| Situation | Result |
| --- | --- |
| Ollama down / model missing | `503 GEMMA_UNAVAILABLE` (never silently degraded) |
| One call times out (90 s) | deterministic result, `aiSource: "fallback"` |
| Malformed JSON | deterministic result, `aiSource: "fallback"` |
| Hallucinated issue number | corrected to a real issue |
| GitHub 403/429/network | demo data, `dataSource: "demo"` |

---

## 5. Test Gemma directly

```bash
curl http://localhost:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gemma4:e2b",
    "stream": false,
    "format": "json",
    "think": false,
    "options": { "temperature": 0.2 },
    "messages": [
      { "role": "user", "content": "Reply with JSON only: {\"ok\":true,\"lang\":\"javascript\"}" }
    ]
  }'
```

Check installed models:

```bash
curl http://localhost:11434/api/tags
```

---

## 6. Common errors and fixes

**`503 GEMMA_UNAVAILABLE` — "Start Ollama"**
```bash
curl http://localhost:11434/api/tags     # if this fails, Ollama is not running
ollama serve                             # start it (some installs autostart)
```

**`503` — Ollama is up but `gemma4:e2b` is not installed**
```bash
ollama list                 # confirm what you have
ollama pull gemma4:e2b      # ~3.5 GB, first pull takes a while
```
Check `OLLAMA_URL` in `.env` if Ollama runs on a different host or port.

**First response takes 30-90 s (or looks hung)**
That is the model loading from disk plus 5 sequential inferences. Normal.
Subsequent identical profiles hit the 10-minute cache and return instantly.
To go faster during development, lower `MAX_ANALYZED_REPOS` in
`services/config.js` to `3`, or set `OLLAMA_KEEP_ALIVE` so the model stays
resident between calls.

**`meta.dataSource` is `"demo"`**
GitHub failed — almost always the anonymous rate limit (10 searches/min,
60 requests/hour total). Create a token at
<https://github.com/settings/tokens> (public repo read is enough) and put it in
`.env` as `GITHUB_TOKEN=ghp_…`, then restart. `DELETE /api/cache` after
changing it.

**`EADDRINUSE: port 3000 already in use`**
```bash
lsof -i :3000              # find the process
kill -9 <pid>
# or change PORT in .env
```

**CORS error in the browser console**
The frontend must run on `http://localhost:5173`. Any `localhost`/`127.0.0.1`
port is allowed by default; for a different host add it to `CORS_ORIGINS`.

**`npm install` reports 3 high-severity advisories**
They come from `braces` via `chokidar` inside **nodemon (dev-only)**. They do
not affect `npm start` and require a breaking nodemon downgrade to "fix".
