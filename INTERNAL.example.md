# Chutes Search - Internal Notes (Example)

This repo is intended to be safe to publish publicly.

Do not commit:
- API keys / OAuth client secrets
- Infrastructure hostnames / IP addresses
- Internal service IDs
- Anything that can identify real users (queries, raw IPs, access tokens)

## Environment Variables (Production)

Configure these via your hosting provider / secret manager. Values shown here are placeholders.

- `CHUTES_API_KEY`:
  - Used only for anonymous "free searches" (3/day per client).
  - Signed-in users should run inference on their own Chutes account via `chutes:invoke`.
- `CHUTES_API_URL` (default: `https://llm.chutes.ai/v1`)
- `CHUTES_MODEL_NAME` (optional default model slug)
- `CHUTES_AUTH_SECRET` (required): encrypts session/token data at rest.

### Sign In With Chutes (IDP / OAuth)

- `CHUTES_IDP_CLIENT_ID` (required)
- `CHUTES_IDP_CLIENT_SECRET` (optional; public clients omit)
- `CHUTES_IDP_SCOPES` (default: `openid profile chutes:invoke`)
- `CHUTES_IDP_REDIRECT_URI` (optional; defaults to `https://<host>/api/auth/callback`)

### Web Search

- `SERPER_API_KEY` (optional but recommended): used for Serper search fallback.
- `SEARXNG_API_URL` / `SEARXNG_API_URLS` (optional): used for SearxNG search.

### Deep Research (Sandbox)

- `SANDY_BASE_URL` (required to enable Deep Research)
- `SANDY_API_KEY` (if your Sandy endpoint requires it)
- `SANDY_AGENT_API_BASE_URL` / `SANDY_AGENT_ROUTER_URL` / `JANUS_ROUTER_URL` (optional)
- `SANDY_AGENT_MODEL` (optional)
- `SANDY_AGENT_SYSTEM_PROMPT` / `JANUS_SYSTEM_PROMPT` (optional)

### Storage

- `DATA_DIR`: persistent directory for SQLite storage (defaults to `./data`).

## Rate Limiting (Anonymous / Free Searches)

Server-side enforcement:
- Per-client daily quota: `3` free searches/day (client tracked by **hashed IP**).
- Global anonymous throttles:
  - `100` free searches/minute (total)
  - `3000` free searches/hour (total)

Client-side enforcement:
- LocalStorage counter (best-effort UX gate).

