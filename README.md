# TRIANGLE Invoice OS

TRIANGLE Invoice OS is an internal invoice and payment management app for design, branding, and architecture teams. It manages issued invoices, received invoices, payments, contracts, and project profitability by project.

## MVP Features

- Login and role-based access control
- Japan / China company switch across the interface
- Client, vendor, and project management
- Compact editable project list
- Project detail page with contract amount, invoicing, payments, and gross profit
- Issued invoice creation and PDF export
- Received invoice upload and payment status management
- Mail sorter for uploaded PDFs/images
- Contract upload with OCR-assisted billing count and amount extraction
- CSV export
- Audit log
- PostgreSQL-backed app data state
- Local or database-backed uploaded file storage

## Local Setup

```bash
npm install
copy .env.example .env
npm run dev
```

Open `http://localhost:3000`.

Demo accounts:

- `admin@triangle.local` / `password123`
- `accounting@triangle.local` / `password123`
- `pm@triangle.local` / `password123`
- `designer@triangle.local` / `password123`

## Database

For local PostgreSQL:

```bash
docker compose up -d
npm run prisma:generate
npm run prisma:migrate
```

The Prisma schema is in `prisma/schema.prisma`. The current application state is stored through `src/lib/store.ts`.

## File Storage

Local development stores files in `public/uploads/received-invoices`.

Production can force database-backed file storage:

```bash
FILE_STORAGE_DRIVER="database"
```

This keeps uploaded PDFs/images viewable on hosts where local disk is ephemeral.

## OCR / AI Classification

Received invoice drop and mail sorting use this flow:

1. Google Cloud Vision OCR extracts text from PDF/JPEG/PNG.
2. OpenAI classifies the document as invoice, contract, estimate, receipt, notice, or other.
3. If it is an invoice, AI extracts vendor name, project hint, issue date, due date, subtotal, tax, and total.
4. The app stores the result as a review draft with warnings and confidence.

Set these variables in `.env`:

```bash
GOOGLE_CLOUD_VISION_API_KEY="..."
OPENAI_API_KEY="..."
OCR_AI_MODEL="gpt-5.4-mini"
```

Google Vision can also use a service account JSON:

```bash
GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}'
```

If keys are not configured, the app falls back to PDF text extraction and local Tesseract OCR. In the MVP, synchronous Google Vision OCR reads up to the first 5 PDF pages.

## Alibaba / VPS Deployment

The Docker deployment files are in `deploy/alibaba`.

```bash
cd deploy/alibaba
cp .env.example .env
docker compose up -d --build
```

Use the same setup on Alibaba Cloud ECS, XServer VPS, or another Ubuntu VPS with Docker.

## Security Notes

- Login is required
- Role-based access control is enforced in server actions and upload APIs
- Uploads allow only PDF, JPEG, and PNG
- Upload size is limited
- Important changes write to AuditLog
- Invoice number duplication is blocked
- Received invoice duplicate detection uses vendor, issue date, and total

## Future TODO

- Full Prisma repository migration
- Background OCR queue for large PDFs
- External vendor upload URL
- Gmail / mail import
- freee and Money Forward integration
- Bank API integration
- Automatic reminder email
- AI invoice validation rules
- Electronic book preservation policy hardening
