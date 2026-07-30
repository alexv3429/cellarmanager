# Setup

## Prerequisites

* Docker for the recommended daily-use deployment
* A modern browser
* For development: Git, uv, Node.js 24+, Bash/make, and optionally GitHub CLI
* Tesseract plus the French language pack when testing OCR locally

Python environments and dependencies are managed from `pyproject.toml` and the committed `uv.lock`; manual `venv`/`pip install` setup is no longer the supported developer path.

## Recommended: the easiest complete path

This app is self-hosted - there's no version of it running anywhere
already, so you need to run it somewhere yourself. The path below is the
one with the fewest moving parts: no domain to buy, no hardware to own,
nothing exposed to the public internet, roughly 15-20 minutes start to
finish, and about $5/month.

**1. Rent the cheapest small cloud server (VPS).** [Hetzner Cloud](https://www.hetzner.com/cloud)
is currently the best value for this (their cheapest shared-CPU plan,
around $5/month, is overkill for a personal cellar app); DigitalOcean is
an equally fine alternative if you prefer it. Sign up, create a server
with **Ubuntu 24.04** and the smallest/cheapest size, and note its IP
address. (Check current pricing when you sign up - it does change.)

**2. Connect to it and install Docker:**
```bash
ssh root@YOUR_SERVER_IP
curl -fsSL https://get.docker.com | sh
```

**3. Get this project onto the server.** If you've pushed this to your own
GitHub repo (as originally planned), the simplest way:
```bash
git clone https://github.com/YOUR_USERNAME/wine-cellar-manager.git
cd wine-cellar-manager
```
(No repo yet? `scp` the tarball up instead: from your own computer,
`scp wine-cellar-manager.tar.gz root@YOUR_SERVER_IP:` then on the server
`tar xzf wine-cellar-manager.tar.gz && cd wine-cellar-manager`.)

**4. Set your secret key and start the app:**
```bash
cp docker/.env.example docker/.env
python3 -c "import secrets; print(secrets.token_hex(32))"
# paste the output as WINECELLAR_SECRET_KEY= in docker/.env (nano docker/.env)
docker compose -f docker/docker-compose.yml up -d --build
```
The app is now running on the server at port 8000, but not reachable from
outside it yet - that's the next step, and it's what makes the browser
willing to install this as an app and cache it for offline use at all
(both require HTTPS).

**5. Make it reachable from your phone, privately, with HTTPS - via
Tailscale.** [Tailscale](https://tailscale.com) creates a private network
between your devices and hands you a real HTTPS certificate with no domain
needed; nothing is exposed to the public internet.
```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up          # follow the login link it prints
tailscale serve https / http://localhost:8000
```
Install the Tailscale app on your phone too (App Store / Play Store) and
sign into the same account.

**6. Open it on your phone.** With the Tailscale app active, open
`https://YOUR-SERVER-NAME.YOUR-TAILNET.ts.net` (shown by `tailscale
status` on the server, or in the Tailscale admin console) in your phone's
browser. Create your account (the first registration bootstraps the owner
account - see `docs/security.md`), then use the **"Install app"** button
this app shows in its own nav bar to add it to your home screen. See
"Installing on your phone" below for the platform-specific tap sequence.

That's it - reachable from your phone anywhere (not just at home), works
offline once you've opened it at least once, and nothing is publicly
exposed. `docker compose ... up -d` and `tailscale serve` both persist
across reboots.

**If you'd rather have a public URL instead of a private Tailscale one**
(e.g. to share cellar access with someone without adding them to your
tailnet), point a domain's DNS at the server and use Caddy instead of
Tailscale for step 5 - see "Alternative: a public domain with Caddy" below.

## Installing on your phone

Once you can open the (HTTPS) address in your phone's browser and you're
logged in:

* **Android (Chrome):** an **"Install app"** button appears in this app's
  own top bar - tap it, or use Chrome's menu -> "Install app" / "Add to
  Home screen".
* **iPhone/iPad (Safari):** Safari doesn't support that automatic prompt,
  so this app's "Install app" button instead shows you the steps: tap the
  **Share** icon (square with an arrow), then **"Add to Home Screen"**.

Either way you get a normal-looking app icon that opens full-screen, with
no browser address bar, and keeps working (viewing/adding to your
already-synced data) without a connection.

**On a computer:** same idea - open the HTTPS address in Chrome/Edge and
use the install icon in the address bar, or just use it as a regular
bookmarked tab.

## Alternative: a public domain with Caddy

If you'd rather have a normal public URL than a private Tailscale one,
point your domain's DNS `A` record at the server's IP, then run Caddy
instead of `tailscale serve`:
```
your-domain.example {
    reverse_proxy localhost:8000
}
```
Caddy gets you a free, auto-renewing Let's Encrypt certificate with no
extra steps. This exposes the app to the public internet (still behind
login - see `docs/security.md` for hardening before doing this).

## Local development (for hacking on the code, not for daily phone use)

Install uv and Node.js 24+, then from the repository root:

```bash
./scripts/bootstrap_dev.sh
cp backend/.env.example backend/.env
# edit backend/.env and set WINECELLAR_SECRET_KEY
make run
```

`bootstrap_dev.sh` synchronizes `.venv` from `uv.lock`, applies the one-time Ruff migration, installs commit/push hooks, and runs the complete local CI gate. Subsequent work normally uses `make format`, `make test`, and `make ci`. See `docs/development.md`.

The application opens at `http://localhost:8000/`. `localhost` is treated as a secure context by browsers, so the PWA and service worker work for local testing.

### Try it with the sample data

```bash
# after registering your account and grabbing the access_token it returns:
python3 seed_demo_data.py --token YOUR_ACCESS_TOKEN
```

This creates three example cellars and imports `sample_data/sample_cellar_en.csv`.
`sample_data/sample_cellar_fr.csv` is the same idea in French-locale CSV
form (semicolons, comma decimals) if you want to test that path.

## Docker, standalone reference

```bash
cp docker/.env.example docker/.env   # then fill in WINECELLAR_SECRET_KEY
docker compose -f docker/docker-compose.yml up -d --build
```
`docker/.env` is loaded automatically by Compose (it's excluded from git
via `.gitignore`, same as the top-level `.env`). This builds one image
containing both the API and the frontend static files, and persists the
SQLite database in a named Docker volume.

## Security & backups

Set a real `WINECELLAR_SECRET_KEY` (required - Compose will refuse to
start without one), keep the `winecellar-data` volume (or `backend/data/`
outside Docker) backed up, since it's the entire database, and read
`docs/security.md` before exposing this beyond your own network.

## Environment variables

See `.env.example` in `backend/` (or `docker/.env.example` for the Docker
path) for the full list with explanations: secret key, database path,
token lifetime, CORS origins, login throttle.

## Dependency and workflow maintenance

Do not edit `backend/requirements*.txt` directly. Change dependencies with `uv add` / `uv add --dev`, commit `pyproject.toml` and `uv.lock`, regenerate compatibility exports with `make requirements`, and run `make ci`. Activate required GitHub checks using `docs/github-protection.md`.

<!-- modern-dev-portability-fix -->
## Portable uv lock files and virtual environments

The committed `uv.lock` must use public, portable package sources. It must not
contain developer-specific, corporate-only, or build-environment registry URLs.
Generate or verify it with `make lock` and `make ci`; the repository policy check
rejects known private build-registry references.

CellarManager's uv environment is the repository-level `.venv`. If an older
`backend/.venv` is active, deactivate it or run `unset VIRTUAL_ENV` before setup.
The bootstrap script also ignores that obsolete activation automatically.

If dependency installation fails against `pypi.org` or
`files.pythonhosted.org`, inspect corporate proxy/TLS settings. A failure against
`internal.api.openai.org` means an old, non-portable lockfile is still present.

## Configure Internet enrichment

Copy the documented variables from `backend/.env.example`. At minimum set
`WINECELLAR_OPENAI_API_KEY` (or `OPENAI_API_KEY`) and keep
`WINECELLAR_ENRICHMENT_PROVIDER=openai_web`. Restart the backend, then verify
`GET /enrichment/status` reports `configured: true`.

For Brave discovery set both `BRAVE_SEARCH_API_KEY` and the OpenAI key, then use
`WINECELLAR_ENRICHMENT_PROVIDER=brave_openai`. External API usage may be billed.
