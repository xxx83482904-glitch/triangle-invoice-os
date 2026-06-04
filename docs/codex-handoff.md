# Codex Handoff

This document is for continuing TRIANGLE Invoice OS work from another PC or
another Codex session.

## Repository

- GitHub: `https://github.com/xxx83482904-glitch/triangle-invoice-os.git`
- Main branch: `main`
- Check the current prepared commit with `git log -1 --oneline` after cloning.
- Local Windows workspace used so far:
  `C:\Users\info\Documents\Codex\2026-05-13\pdf-invoice-os-triangle-invoice-os`

## Important Local Rule

Read `AGENTS.md` before coding. This project uses Next.js `16.2.6`, and the
checked-in instruction says to read the relevant docs under
`node_modules/next/dist/docs/` before changing Next.js APIs or route handlers.

## Quick Setup On Another PC

```powershell
git clone https://github.com/xxx83482904-glitch/triangle-invoice-os.git
cd triangle-invoice-os
npm.cmd ci
copy .env.example .env
npm.cmd run build
npm.cmd run dev
```

Open `http://localhost:3000`.

Demo accounts:

- `admin@triangle.local` / `password123`
- `accounting@triangle.local` / `password123`
- `pm@triangle.local` / `password123`
- `designer@triangle.local` / `password123`
- `guest@triangle.local` / `password123`

## Required Environment Values

Use `.env.example` as the base. Do not commit real secrets.

For OCR + AI classification:

```env
GOOGLE_CLOUD_VISION_API_KEY=
OPENAI_API_KEY=
OCR_AI_MODEL=gpt-5.4-mini
```

For the optional self-deploy endpoint:

```env
ALLOW_SELF_DEPLOY=false
DEPLOY_TOKEN=
DEPLOY_BRANCH=main
```

Keep `ALLOW_SELF_DEPLOY=false` unless this is a trusted self-hosted deployment.

## Current Synology Production

- DSM LAN URL: `https://192.168.1.218:5001/`
- Public app URL: `https://trianglejp14f.synology.me/login`
- Public port URL: `http://trianglejp14f.synology.me:3000/login`
- Container Manager project: `triangle-invoice-os`
- Container name: `triangle-invoice-os`
- Synology project folder: `/volume1/docker/triangle-invoice-os`
- App folder in container/volume: `/volume1/docker/triangle-invoice-os/app`
- Data folder: `/volume1/docker/triangle-invoice-os/data`
- Uploads folder: `/volume1/docker/triangle-invoice-os/uploads`

The live Synology container starts from `node:24-bookworm-slim`. On container
start it fetches GitHub `main`, resets to it, runs `npm ci --include=dev`, runs
`npm run build`, and then starts the app.

The latest production check returned:

- `https://trianglejp14f.synology.me/login` -> `200 OK`
- `https://trianglejp14f.synology.me/api/admin/deploy` -> JSON
  `{"error":"Self deploy is disabled"}`, which means the endpoint exists but is
  disabled until environment variables are set.

## Deploy Paths

### DSM UI

Open Container Manager, select project `triangle-invoice-os`, then use
`操作` -> `再起動`. The container start command pulls the latest GitHub `main`.

### SSH Deploy

SSH is currently not enabled on `192.168.1.218:22`.

If enabled later, deploy from Windows:

```powershell
.\deploy\synology\deploy-ssh.ps1 -User <dsm-user>
```

### Self-Deploy API

After setting these live container variables:

```env
ALLOW_SELF_DEPLOY=true
DEPLOY_TOKEN=<long-random-token-at-least-32-characters>
DEPLOY_BRANCH=main
```

deploy from Windows:

```powershell
.\deploy\synology\deploy-api.ps1 -Token <long-random-token-at-least-32-characters>
```

Read deploy logs:

```powershell
.\deploy\synology\deploy-api.ps1 -Token <long-random-token-at-least-32-characters> -LogsOnly
```

## Do Not Commit

These local files may exist in the original workspace and should stay untracked:

- `deploy/synology/docker-compose.synology-live.yml`
- `deploy/triangle-invoice-os-synology.zip`
- `.env`, `.env.local`, `.env.production.local`
- runtime folders such as `.next`, `data`, `node_modules`, and uploaded files

## Current Feature State

- Dashboard and all main pages use the smaller blue unified UI.
- Project list is compact, editable, sortable, and supports Japan/China company
  switching.
- Mail sorter uses a 3-column folder/list/detail layout.
- Mail folders can be added, edited, deleted, resized, and documents can move by
  drag and drop.
- OCR flow uses Google Vision plus AI classification when configured.
- OCR results list supports monthly grouping, inline editing, bulk selection,
  delete, and CSV export.
- Uploaded preview URLs support Japanese/Chinese OCR-derived filenames.
- Deleting OCR documents also removes stored upload files.
- Invoice-like OCR documents can reflect into received invoices.

## Verification Commands

Run these before handing off changes:

```powershell
npm.cmd run lint
npm.cmd run build
git status --short
```

Known non-blocking build warning:

`next.config.ts -> src/lib/files.ts -> src/app/api/uploads/received-invoices/ocr-drop/route.ts`

Next/Turbopack reports an NFT file tracing warning due to dynamic file-system
use. The app still builds successfully.
