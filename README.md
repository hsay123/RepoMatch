# RepoMatch frontend

React + Vite JavaScript frontend for discovering open-source projects and their recommended first contribution. The frontend communicates with the separate backend in `backend/`; GitHub and Ollama calls stay on the backend.

## Run locally

```sh
npm install
npm run dev
```

Run these commands from the repository root. Vite serves the app at `http://localhost:5173` (the port is fixed). The matching backend is expected at `http://localhost:3000`.

## Backend contract

All requests are centralized in `src/services/api.js`:

- `GET /api/health`
- `POST /api/matches` with `{ "skills": [], "interests": [], "experience": "", "contributionTypes": [] }`

The matches response is `{ "repositories": [...] }`. Each repository may provide `id`, `name`, `fullName`, `owner`, `description`, `url`, `stars`, `forks`, `language`, `topics`, `goodFirstIssueCount`, `matchScore`, `whyMatch`, and `recommendedIssue`. The recommended issue may provide `title`, `number`, `url`, `difficulty`, `skills`, and `explanation`. Optional fields are rendered defensively.

The backend should allow browser requests from `http://localhost:5173` (CORS). Set `VITE_API_URL` to override the default backend origin.

## Deploy the frontend on Vercel

1. Import `hsay123/RepoMatch` into Vercel.
2. Set the project root directory to `.`. The Vite `package.json` is at the repository root.
3. Use the Vite framework preset, build command `npm run build`, and output directory `dist`. Vercel can install dependencies with `npm install`.
4. Add `VITE_API_URL` in the Vercel project environment variables. Set it to the public backend origin, for example `https://api.example.com`, without a trailing slash or `/api` path. Apply it to Production and Preview as needed, then redeploy.
5. On the backend host, set `CORS_ORIGINS` to the exact Vercel site origin, such as `https://your-project.vercel.app`. Add any custom domain there too. Multiple origins are comma-separated; preview deployments may need their exact origins added because the backend checks for exact matches.

Vercel deploys only the frontend. Matching works only when the backend is reachable over the internet. The backend also needs access to Ollama/Gemma; its default `OLLAMA_URL=http://localhost:11434` refers to the backend host itself, not a visitor's computer. Keep `GITHUB_TOKEN` and other secrets on the backend, never in Vercel `VITE_*` variables.

For local development, `.env.example` points `VITE_API_URL` at `http://localhost:3000`; copy it to `.env.local` if you need to override the default.

## Verify

```sh
npm run build
npm run lint
```

For independent UI testing, enable mock mode, run `npm run dev`, then complete profile setup, pass/match a repository, and open the recommended GitHub issue.
