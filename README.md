# Cairn Career Copilot

Cairn is a private career-exploration workspace. Users can build a career profile, compare possible paths, run small experiments, plan milestones, journal, and use text-based AI support. Account data is stored per user in Firebase Realtime Database.

## Run locally

Requirements: Node.js 20+ and pnpm 10.

```sh
pnpm install
pnpm --filter @workspace/career-copilot dev
```

The frontend is served by Vite. AI actions use the Express API at `/api`. Start the API server in a second terminal:

```sh
pnpm --filter @workspace/api-server dev
```

Firebase-backed account features still load without an AI key. AI actions use the Gemini API Free Tier model `gemini-3.8-flash` only; no paid model or provider fallback is configured. Free-tier quotas are limited. If the quota is exhausted, the API returns an error instead of switching to a paid service. Google's current Free Tier terms say prompts may be used to improve Google products, so do not send sensitive details. Live Google Search grounding is unavailable in this no-cost configuration.

## Deploy from GitHub to Vercel

1. Push the repository to GitHub, then import that repository into Vercel. Keep the Vercel project root at the repository root; do not deploy only `artifacts/career-copilot`.
2. Keep the committed `pnpm-lock.yaml` and `vercel.json`. The build writes the browser app to `artifacts/career-copilot/dist/public`; the serverless endpoint is `api/index.ts`.
3. Add `GEMINI_API_KEY` from a Google AI Studio project on the **Free Tier** in Vercel's project environment settings for Preview and Production. Keep that project unlinked from paid billing to avoid charges. The key is server-only; never put it in source files, browser variables, or GitHub.
4. The model is fixed to `gemini-3.8-flash` so deployment cannot accidentally switch to a paid model through an environment override. Quota/rate limits still apply.
5. `FIREBASE_PROJECT_ID` is optional when using the included Firebase project. If using another Firebase project, add `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID` in Vercel. These web configuration values are bundled into the browser app; they are not server secrets.
6. In Firebase, enable Email/Password authentication and deploy the repository's `database.rules.json` with `firebase deploy --only database --project <your-firebase-project-id>`. Add the Vercel production domain to Firebase Authentication's authorized domains.

Deploy the repository root and keep these paths in it: `api/`, `artifacts/career-copilot/`, `artifacts/api-server/`, `lib/api-client-react/`, `lib/api-zod/`, `lib/api-spec/`, `database.rules.json`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, and `vercel.json`. Vercel builds the site and API together; there is no need to upload the generated `dist` folder manually.

The Gemini key is used only by the server. The API allows up to 60 seconds for a request to fit the serverless runtime limit.

## Build checks

```sh
pnpm run typecheck
pnpm --filter @workspace/career-copilot build
pnpm --filter @workspace/api-server build
```
