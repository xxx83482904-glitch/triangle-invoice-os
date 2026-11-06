# Synology Deployment

This setup runs TRIANGLE Invoice OS on Synology DSM with Container Manager.

## Files

- `docker-compose.yml`: Container Manager project definition
- `.env.example`: copy to `.env`
- `data/`: app data JSON is stored here
- `uploads/`: uploaded PDFs and images are stored here

## Setup

1. Install **Container Manager** on Synology DSM.
2. Copy this repository to a shared folder, for example:
   `/volume1/docker/triangle-invoice-os`
3. Open `deploy/synology`.
4. Copy `.env.example` to `.env`.
5. Edit `.env`:
   - Set a long random `SESSION_SECRET`
   - Keep `SESSION_COOKIE_SECURE=false` for LAN HTTP access
   - Set it to `true` when using HTTPS through Synology Reverse Proxy
   - Add Google Vision and OpenAI keys if OCR + AI classification is used
6. Create these folders if they do not exist:
   - `deploy/synology/data`
   - `deploy/synology/uploads`
7. Make sure the folders are writable by Container Manager.
8. In Container Manager, create a new Project from `deploy/synology/docker-compose.yml`.
9. Build and start the project.
10. Open:
   `http://<synology-ip>:3000`

## Persistence

Do not delete these folders:

- `deploy/synology/data`
- `deploy/synology/uploads`

Back them up from Hyper Backup or another Synology backup task.

## HTTPS

For production use, place the app behind Synology Reverse Proxy and HTTPS.
After HTTPS is working, set:

```env
SESSION_COOKIE_SECURE=true
```

Then rebuild/restart the project.

## Browserless Deploy For Maintenance

For reliable maintenance from Codex, enable SSH on DSM and restart the app
container from the local machine. The current live Synology container pulls the
latest GitHub `main` branch and rebuilds the app when the container starts, so a
container restart is enough to publish the newest pushed code.

1. In DSM, open **Control Panel** -> **Terminal & SNMP**.
2. Enable **SSH service** on port `22`.
3. Keep SSH limited to LAN or VPN access. Do not expose port `22` directly to the
   public internet.
4. Use a DSM user that is allowed to run Container Manager / Docker commands.
5. From this repository on Windows, run:

```powershell
.\deploy\synology\deploy-ssh.ps1 -User <dsm-user>
```

Optional parameters:

```powershell
.\deploy\synology\deploy-ssh.ps1 `
  -User <dsm-user> `
  -HostName 192.168.1.218 `
  -ContainerName triangle-invoice-os `
  -PublicUrl https://trianglejp14f.synology.me/login
```

This avoids depending on the DSM web UI for routine deploys.

## Self-Deploy API

After one manual deploy that includes this feature, Synology can be updated
without DSM browser operations or SSH. Enable it only on a trusted private
deployment.

Set these variables in the live container environment:

```env
ALLOW_SELF_DEPLOY=true
DEPLOY_TOKEN=<long-random-token-at-least-32-characters>
DEPLOY_BRANCH=main
```

Then trigger a deploy from a trusted machine:

```powershell
.\deploy\synology\deploy-api.ps1 -Token <long-random-token-at-least-32-characters>
```

Equivalent raw curl:

```powershell
curl.exe -k -X POST `
  -H "x-deploy-token: <long-random-token-at-least-32-characters>" `
  https://trianglejp14f.synology.me/api/admin/deploy
```

Check the latest deploy log:

```powershell
.\deploy\synology\deploy-api.ps1 -Token <long-random-token-at-least-32-characters> -LogsOnly
```

The endpoint fetches GitHub `main`, rebuilds the app, and then exits the app
process so Docker's restart policy starts the fresh build. Keep the token secret.

## Running Build Verification

`GET /api/version` is public and returns only `{ "build": "<40-character SHA>" }`
(or `{ "build": null }` when unknown), with `Cache-Control: no-store`. The SHA is
embedded at build time and captured once at server startup, so overwriting the
build on disk cannot make an old process claim to serve a new commit. Builds use
`TRIANGLE_BUILD_SHA` when explicitly set (40 lowercase hex characters), otherwise
`git rev-parse HEAD`; builds without Git metadata report an unknown SHA.

The Deploy Synology workflow keeps the existing build-log wait, then waits up to
15 minutes for `/api/version` to report the pushed commit or a descendant verified
with Git (a later deployed commit produces a workflow warning). An unknown or
unrelated SHA never passes. It then checks `/login` = 200, `/api/section-export` =
401, and an unauthenticated `/api/admin/deploy` = 403 with `Invalid deploy token`.
The deploy probe runs only after the first two pass, with at most three rounds,
10 seconds apart. The live-check script receives and sends no deploy token.

## Default Login

- `admin@triangle.local`
- `password123`

Change passwords before real operation.
