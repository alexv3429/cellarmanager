# Security (requirement 9: "no one shall access my cellars without strong credentials")

## Authentication model

* **No open public sign-up.** `POST /auth/register` only succeeds while the
  `users` table is empty - it exists purely to bootstrap the first (owner)
  account. Every subsequent account is created via `POST /auth/users`,
  which itself requires being logged in already. This is deliberate: a
  personal wine cellar tracker should not be an open registration system.
* **Passwords** are hashed with PBKDF2-HMAC-SHA256, a random 16-byte salt
  per user, and 210,000 iterations (`app/services/auth_service.py`) -
  a NIST-recommended construction from the standard library, not a
  custom cipher. Verification uses a constant-time comparison
  (`hmac.compare_digest`).
* **Sessions** are a compact HMAC-SHA256-signed token (conceptually a JWT,
  implemented directly so no extra dependency is required for a
  single-instance, self-hosted deployment). It carries an expiry
  (`WINECELLAR_TOKEN_TTL_SECONDS`, default 12h) and is rejected outright if
  the signature doesn't match, if it's expired, or if it's malformed.
* **Login throttling**: an in-memory limiter blocks further attempts for a
  username after `WINECELLAR_LOGIN_MAX_ATTEMPTS` failures within
  `WINECELLAR_LOGIN_WINDOW_SECONDS` (defaults: 5 / 300s). This is a
  best-effort, single-process protection - see "What this does not cover"
  below.
* **Every business endpoint** (wines, cellars, holdings, import/export,
  stats, moveplan, recommendations, enrichment, photos) requires a valid
  bearer token; only `/health`, `/auth/*`, and `/i18n/{locale}` are public.

## Secrets

`WINECELLAR_SECRET_KEY` signs every session token. If it's not set, the app
generates a random one at startup and logs a warning - this is a safe
default (never a hardcoded fallback secret) but means everyone is logged
out on every restart. Set a real, persistent value via your environment or
`.env` before relying on this day to day:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Never commit a real `.env` file; `.gitignore` already excludes it.

## Transport security

This app does not terminate TLS itself. For anything beyond `localhost`,
put it behind a reverse proxy that does (Caddy, nginx + Let's Encrypt,
Cloudflare Tunnel, etc.) - see `docs/setup.md`. Browsers require HTTPS (or
`localhost`) for service workers and PWA installability, so this is
required for the offline feature to work too, not just for security.

## What this does not cover (be aware before exposing this publicly)

* **No rate limiting beyond login** - a reverse proxy or firewall should
  handle general abuse/DoS protection for anything internet-facing.
* **No two-factor authentication / passkeys.** For a household-scale,
  password-protected app behind your own network or HTTPS, this is a
  reasonable trade-off; it would be a meaningful v2 addition
  (WebAuthn) if this ever protects something higher-value.
* **No audit log of login attempts beyond in-memory throttling** - the
  `movements` journal covers changes to the cellar, not authentication
  events.
* **No built-in backup mechanism** - `backend/data/winecellar.db` (or
  wherever `WINECELLAR_DB_PATH` points) is the entire database; back it up
  the same way you'd back up any important file.

## Recommended hardening checklist before exposing this beyond your home network

- [ ] Set a real `WINECELLAR_SECRET_KEY`
- [ ] Serve over HTTPS via a reverse proxy
- [ ] Set `WINECELLAR_CORS_ORIGINS` to your actual domain, not `*`
- [ ] Restrict access at the network level too if possible (VPN/Tailscale,
      IP allowlist, or Basic Auth on the reverse proxy as a second layer)
- [ ] Keep regular backups of the SQLite file
- [ ] Keep Python and the locked dependency versions up to date through reviewed pull requests


## Development and supply-chain controls

Runtime and development dependencies are resolved in `uv.lock`; CI and Docker refuse an out-of-date lock through frozen synchronization. Dependabot opens reviewed updates for uv dependencies and GitHub Actions. Pull requests run GitHub dependency review and reject newly introduced dependencies with known moderate-or-higher vulnerabilities.

Repository policy checks reject tracked database files, `.env`, private-key-like files, coverage output, and patch backups. These checks reduce accidental disclosure but are not a replacement for GitHub secret scanning or careful review. Enable GitHub secret scanning and CodeQL default setup when available.

Protect `main` and include administrators in the rule. A workflow file without required branch protection can still be bypassed by a direct push or an unchecked merge. Follow `docs/github-protection.md`.

## External research security

Provider keys are environment variables only. Do not commit `backend/.env`.
CellarManager calls only the configured OpenAI and/or Brave API endpoints; it
does not fetch model-supplied evidence URLs server-side. Displayed evidence is
restricted to public HTTP(S) URLs and private/local targets are rejected.

Use `WINECELLAR_ENRICHMENT_CA_BUNDLE` for an organisation-approved corporate TLS
CA (for example Zscaler). Never disable certificate verification. Only wine
identity and requested topics are sent to providers. Search/model output is
untrusted: strict schemas are used, invented evidence URLs are discarded, and
manual values require explicit replacement. Set job/token budgets, restrict
allowed search domains where appropriate, and review provider terms before
enabling the feature.
