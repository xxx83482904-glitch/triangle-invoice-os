# AI cross-document review

## Scope and entry points

Implemented locally; not deployed. Open `/banking/reconcile?company=JAPAN&view=checks`
or select a bank movement in the normal reconciliation view.

- The AI reads bank descriptions, issued/received invoices, and invoice/receipt mail together.
- It proposes possible relationships, including name variations, combined invoices, partial payments,
  and postal documents not yet linked to a received invoice.
- Each proposal shows source excerpts, canonical document links, independently calculated amounts,
  and cautions. AI text is a hypothesis, not a verified accounting conclusion.
- Confirmation uses the existing reconciliation flow. AI itself never creates payments, changes
  invoice/mail status, transfers money, or removes documents.
- A separate company-wide rules list flags status inconsistencies, potential duplicates,
  unlinked mail, and unmatched expenses. These are not AI findings and do not prove missing documents.
- Known credit-card/other account movements, transfers, excluded/source-missing/future movements,
  and conflicting records are not automatically matched as bank cash movements.

## Configuration and operation

Administrators can open **AI設定** at the top of the reconciliation page. Accounting users can
run reviews but cannot change API settings; billing-only and mail-only users cannot access this feature.

The feature reuses the existing OCR OpenAI configuration, not Money Forward credentials:

- `OPENAI_API_KEY` overrides the saved `openAiApiKey` in `DATA_DIR/ocr-settings.json`.
- `OCR_AI_MODEL` overrides the saved `ocrAiModel`; otherwise the existing OCR default applies.
- Use a model available to the account that supports Chat Completions strict JSON Schema output.
- Shared key/model changes also affect OCR AI classification. Saving settings does not call AI.
- Keys are password inputs and are not returned by the settings endpoint. Do not put secrets in
  chat, Git, screenshots, logs, or this document. Protect the existing settings file on the NAS.

Choose the bank transaction or transaction month, open **AIで候補を探す**, review the exact outgoing
JSON, then explicitly consent and send. Results are transient and disappear on reload/context change.
The local synthetic preview currently has no configured OpenAI API key.

## Data, privacy, and limits

Only the selected company is eligible. The server builds bounded context:

- At most 20 unmatched bank movements (newest first in the chosen month).
- At most 40 same-direction eligible invoices, ranked by deterministic match candidates then date proximity.
- At most 30 invoice/receipt mail records, prioritizing selected invoice links and the relevant month.
- Income-only contexts omit postal receipts. The UI displays selected/total counts: this is not an
  exhaustive review of every document, and older/unselected records may not be examined.
- Names, descriptions, dates, amounts, states, and up to six relevant OCR lines (500 characters)
  are sent. Original files, internal memos, source memos, and database IDs are not sent as analysis data.
- Emails, URLs, common token patterns, account-like identifiers and long numbers are masked.
  Masking is intentionally not described as complete anonymization: names and private text may remain.
- Requests go only to `https://api.openai.com/v1/chat/completions`; redirects are rejected.
  `store: false` is used but does **not** guarantee zero provider retention.

Provider references:
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[data controls and retention](https://developers.openai.com/api/docs/guides/your-data).

Company usage is capped at 50 attempts per Japan-time day, with a 15-second cooldown.
The server timeout is 45 seconds, output is limited to 4,000 completion tokens and 100 KB response size,
and there are no automatic retries. Failed provider attempts also consume the local quota.
These limits reduce accidental usage but are not a monetary budget; configure provider-side limits too.

`AppData.bankAiUsage` is persistent and is deliberately outside financial Undo snapshots.
The store lock reserves usage before the remote call; the network call happens outside that lock.
This follows the current single-process Synology store architecture. Multiple independent app workers
would require a shared transactional rate limiter before enabling AI.

## Validation and authorization

- Server actions validate explicit consent, strict scope input and the exact preview revision.
- Current active-user permissions are checked before work, inside the usage reservation lock,
  and again after the provider returns.
- Company scoping and a hash of selected data/payment versions detect stale previews and changes
  during analysis. Stale or newly unauthorized results are discarded.
- Strict output schema, local B/I/M aliases, direction checks, and exact source-quote checks reject
  fabricated references and evidence. This validates provenance, not the truth of an AI interpretation.
- Amounts and differences are calculated by the server. Mail is never added a second time to an
  already counted invoice; postal-only results show an unknown amount.
- OCR text is untrusted data. The model has no tools, database write access, or payment actions.
- Provider errors are sanitized. Audit entries contain company, counts, scope mode and model only,
  not prompts, raw financial descriptions, API keys or model output.

## Implementation and verification

Core modules: `src/lib/bank-ai-types.ts`, `bank-ai.ts`, `bank-ai-client.ts`, `bank-ai-service.ts`,
`bank-review.ts`. UI: `bank-ai-panel.tsx`, `bank-ai-settings.tsx`, `bank-review-panel.tsx`,
and the reconciliation workspace/page.

Verification on the isolated synthetic preview:

- Full unit suite: 186 passed, including 19 AI/context/provider/workflow tests.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` passed.
- `tests/check-bank-ai.ts`: real HTTP page/action authorization, missing-key/consent/schema guards,
  admin-only settings, normalized month and unchanged financial/usage data passed.
- Responsive checks: 390x844, 768x1024 and 1440x1000; screenshots and DOM overflow checks.
- The OpenAI provider and successful workflow are tested with synthetic, injected responses.
  No live paid AI request or real reconciliation accuracy test has been performed because the
  local preview has no API key. No production data has been transmitted.
- Browser automation clicks currently have no effect in the available session. Rendering and
  real HTTP server-action guards were verified; interactive dialog submission remains unverified.

For the HTTP test, use only the disposable `triangle-banking-preview-*` DATA_DIR and existing
`http://localhost:3018` dev server. The script refuses a configured OpenAI key and non-synthetic data.
Never point this integration test at production.
