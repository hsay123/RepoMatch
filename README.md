# RepoMatch frontend

React + Vite JavaScript frontend for discovering open-source projects and their recommended first contribution. This repository contains no backend, GitHub API integration, or Ollama integration.

## Run locally

```sh
cd frontend
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173` (the port is fixed). The matching backend is expected at `http://localhost:3000`.

## Backend contract

All requests are centralized in `src/services/api.js`:

- `GET /api/health`
- `POST /api/matches` with `{ "skills": [], "interests": [], "experience": "", "contributionTypes": [] }`

The matches response is `{ "repositories": [...] }`. Each repository may provide `id`, `name`, `fullName`, `owner`, `description`, `url`, `stars`, `forks`, `language`, `topics`, `goodFirstIssueCount`, `matchScore`, `whyMatch`, and `recommendedIssue`. The recommended issue may provide `title`, `number`, `url`, `difficulty`, `skills`, and `explanation`. Optional fields are rendered defensively.

The backend should allow browser requests from `http://localhost:5173` (CORS). Set `VITE_API_URL` to override the default backend origin.

## Demo mode

Copy `.env.example` to `.env.local`, set `VITE_USE_MOCK_DATA=true`, and start Vite. The UI then uses five realistic repositories in `src/services/mockData.js`, without silently replacing real-backend errors. Remove or set the flag to `false` to use the backend. Mock mode can be tested without a running backend; the health badge remains offline unless `/api/health` explicitly reports Gemma availability.

## Verify

```sh
npm run build
npm run lint
```

For independent UI testing, enable mock mode, run `npm run dev`, then complete profile setup, pass/match a repository, and open the recommended GitHub issue.
