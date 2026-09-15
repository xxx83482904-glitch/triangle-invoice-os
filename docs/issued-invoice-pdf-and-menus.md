# Issued Invoice PDF and Row Actions

## Changes

- New invoice creation is available from the page header. A successful save opens the created invoice in the preview panel.
- Generated PDFs use the supplied ruled A4 layout and TRIANGLE issuer/address/bank details in `src/lib/issued-invoice-pdf.ts`. The sample's unrelated company seal is not reused.
- The user-supplied TRIANGLE seal is embedded unchanged next to the issuer on the first page, with company name above address. The image is stored at `DATA_DIR/company-seal.png` on Synology, never in the public GitHub repository or `public`. An optional `INVOICE_SEAL_PATH` overrides the private path. Admin-only same-origin `POST /api/admin/company-seal` accepts a PNG file in multipart field `file`. Deployments preserve this data file; backups must include it.
- Japanese font is bundled under `public/fonts`, including its license. PDFKit remains external to the Next.js server bundle; standalone tracing includes the font.
- Uploaded originals still return their original bytes, without applying the generated template.
- Right-click and each row's overflow menu offer edit/preview, open PDF/original, and delete for editable issued invoices. Selection toolbar supports batch deletion.
- Deletion requires confirmation, current record versions, existing invoice permissions, and company/project scope. It rejects invoices with payment records or paid status.
- Deletion is soft; original files and line items are retained for auditing and the existing administrator undo flow. Deleted invoices and their attachments disappear from the canonical list and downloads.

## Verification

- `npm run test:documents`
- `npm run test:invoice-pdf`
- `npm run lint`
- `npm run build`
- `node --import tsx tests/render-invoice-preview.ts` requires Poppler (`pdftoppm`) and writes fictional samples to the OS temporary folder.
- Local browser checks: invoice creation, generated PDF HTTP 200, context menu editing, cancel/delete, deleted PDF HTTP 404, Shift-selection and two-invoice deletion, phone/tablet/desktop layouts.

Production deployment is separate and requires an explicit user request.
