# Editable design quotations

Public app: https://invoice.kuremasato.com/design-fee-calculator

In the calculator, choose 「この計算結果から見積書を作成」. Edit the quotation, choose 「PDFを作成・プレビュー」, then 「PDFを保存」. Preview and download use the same generated PDF. Editing invalidates the old PDF link until regenerated.

## Template and fields

Service content is based on the user-provided `260707_TATA木门_空间设计项目报价单_the triangle.jp.pdf`. The visual design follows the vault's `wiki/concepts/THE TRIANGLE プレゼンフォーマット.md` (September 25 rules): pure white, #141414 ink, thin rules, whitespace, small English labels, and the original outlined footer wordmark. At the user's request, typography is adapted to a business document: 19pt document title, 15pt project and section headings, 12pt stage headings and a right-aligned 23pt total. Body text remains approximately 9–10pt. Oversized English cover lettering and large stage numbers are removed.

The standard quote has five pages: project/total cover; fees, conditions and issuer; two pairs of service stages in independent columns; exclusions. Drawings receive their own large-format appendix pages. Long edited text and columns paginate independently. No shaded cards, enclosed boxes or decorative stock images are used.

The wordmark is exported unchanged from Figma file `moFKrQlW3JHnvwdspdyfA4`, node `180:26`. Its original SVG paths are bundled in `src/assets/triangle-wordmark.svg` and drawn as vectors in every PDF. It is not recreated with typed text. Typography uses Noto Sans SC and Montserrat (regular/bold), the substitutions specified in the vault. Original source PDF, seals and project drawings are not bundled.

Editable: title, quote number, issue date, validity, client, project, service, period, area and area breakdown, designer, stage names/goals/items/deliverables, enabled stages, exclusions, payment terms, notes, issuer/address/contact/name, base fee, additional fee, discount, and tax treatment/rate. Up to 12 PDF/PNG/JPEG drawing files, seal and signature are optional local uploads. Drawing captions, order and removal are editable. PDF drawings (8MB and 50 pages per file, without password protection) are appended in their original page size and rotation; vector contents remain vector. Original drawing pages are not overprinted with a footer. An attachment list identifies files in the quote. Reference project diagrams and signatures are never bundled. The reference TATA project, 550 RMB unit rate and first-cooperation discount are not carried into new quotes.

Seal and signature images appear beside the issuer, with transparent PNG supported. Starting a new quote keeps the seal only when the issuer matches. Seals are part of the local draft/JSON, never a public static asset. The Shanghai seal extracted at the user's request remains a local file and can be selected through 「印影を追加」.

Initial body copy is Chinese, as in the reference. The document language selector changes document labels; body copy and title remain explicitly editable without silent translation. The UI follows the app's Japanese/Chinese switch.

Amounts are copied as a snapshot from the calculator. Later edits affect only the quote. 「計算結果を再取込」 refreshes project/area/base/additional and clears the discount, while preserving text and tax settings. New draft creation first downloads a backup of the existing draft. A restored or modified draft differing from the calculator is identified visibly.

## Calculation

Amounts are whole RMB and use decimal.js. Subtotal = base + additional - discount. Exclusive tax is rounded to whole RMB and added; inclusive tax is extracted without adding it again. Unspecified tax is explicitly marked for confirmation in the PDF. No actual tax rate is assumed. Average unit price is base/area, never multiplied back to obtain totals. Chinese uppercase money uses the final total. Invalid amount/date/area/discount/tax values block PDF generation.

## Storage and privacy

All PDF generation runs in the browser. No quote data, drawings, seal or signature are uploaded. The current draft is automatically stored in this browser under `triangle-quotation-v1`. JSON draft export/import provides per-project storage and cross-device transfer; it is the editable source, while the PDF is the issued static document. Browser storage is origin-specific; use JSON to move between the NAS host and invoice.kuremasato.com. Storage failure is shown with a file-save fallback.

Image inputs are converted locally, bounded to 1600px and limited to 12MB per source file and 2MB data URLs. PDF inputs are validated locally with pdf-lib. Combined draft data is limited to ~11MB; storage quota failure leaves JSON export available. Import validates version, types, limits and PNG/JPEG/PDF data URLs and rejects external URLs/SVG. Fonts and PDF libraries are served from the same app; font loading/generation is deferred until requested. The bundled SIL OFL fonts are subset into PDFs, making CJK text searchable without relying on device fonts. Unsupported characters are reported instead of silently omitted.

## Maintenance and verification

- Template, labels, validation and money: `design-fee-calculator/src/quotation.ts`.
- PDF pagination/typography: `design-fee-calculator/src/quotationPdf.ts`.
- Editor: `QuotationEditor.tsx`, `quotation.css`.
- Font source/license: `design-fee-calculator/public/fonts/`.
- `npm --prefix design-fee-calculator test`: 147 tests, including 36 quotation tests.
- PDF attachments: multiple original pages, landscape A3, rotated A4, editable caption/JSON round trip, corrupt/oversized/overlong PDF rejection. Browser upload, reorder, seal transparency and downloaded combined PDF checked.
- Redesigned standard 5-page, long Japanese 10-page, and long-column/maximum-amount 6-page PDFs rendered and visually inspected with PyMuPDF. Font rendering, text extraction, totals, independent columns and body bounds checked.
- Browser: adjusted total 4,407,480 RMB, actual downloaded PDF text, JSON download/import, invalid input, outdated PDF suppression, desktop and 390px mobile layout checked.

Build and deploy through the existing NAS workflow: `npm run build:design-fees`, `npm run build`, then commit source and `public/design-fee-calculator/` together and push `main` when deployment is authorized. The source reference PDF and private test downloads are not published.
