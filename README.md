# testset-generator

A guided web tool that turns your raw support/product conversation data into
production-shaped **LLM evaluation test cases**: anonymize → analyze (lexicon,
intents, register) → generate realistic noisy + code-mixed cases → review →
export (JSONL).

Full design docs live in [`docs/`](docs/) — start with
[`docs/design/02-architecture.md`](docs/design/02-architecture.md) and
[`docs/design/09-mvp-roadmap.md`](docs/design/09-mvp-roadmap.md).

## Quickstart

```bash
cp .env.example .env      # add your LLM_API_KEY (or set LLM_PROVIDER=ollama)
docker compose up
```

- Web UI: http://localhost:8080
- API: http://localhost:8000
- Postgres (pgvector) + background jobs inside the api container — no extra services.

## Demo mode

The frontend is a standalone SPA: when `VITE_API_URL` is empty **or the API is
unreachable**, it runs entirely on mock data. This is what powers the
Cloudflare Pages demo (deployed to `testsets-generator.adithyakpb.com`) —
anyone can click through the full guided flow without a backend. To use a real
backend, set `VITE_API_URL` at build time (Pages build env or compose
`.env`).

## Deploy

### 1. Create the GitHub repo & push

```bash
git remote add origin git@github.com:<owner>/testset-generator.git
git push -u origin main
```

CI (`.github/workflows/ci.yml`) runs on every PR and push to main:
backend pytest + frontend build.

### 2. Frontend → Cloudflare Pages

Handled automatically by `.github/workflows/deploy-pages.yml` on push to main.

1. Create a Cloudflare API token with **Cloudflare Pages — Edit** permission
   and grab your Account ID (dash.cloudflare.com → right sidebar).
2. Repo → Settings → Secrets and variables → Actions, add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. Create the Pages project named **`testsets-generator`** (or let the first
   workflow run create it).
4. Custom domain `testsets-generator.adithyakpb.com`: add it once in
   **Workers & Pages → testsets-generator → Custom domains** (wrangler can't
   do this; the domain zone must be on the same account).
5. Push to main → Pages deploy runs (builds in demo mode unless you set
   `VITE_API_URL` in the workflow).

### 3. Backend → self-host

`.github/workflows/deploy-server.yml` builds the backend image on push to
main/tags and pushes it to GHCR (`ghcr.io/<owner>/<testset-generator>/api`).

To self-host: copy `docker-compose.yml` + a real `.env` to the server
(`/opt/testset-generator`), switch the `api` service from `build:` to the
pushed GHCR image, and `docker compose up -d`. An SSH auto-deploy job
placeholder (needs `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` secrets) is
included, commented out, in the workflow.
