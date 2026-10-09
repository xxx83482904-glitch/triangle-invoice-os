# Bank Account Category AI

## Behavior

- Existing automatic classification uses rules, confirmed exact-description history and a small built-in keyword list. It is not an AI model.
- The separate AI classification action proposes root account categories for unclassified bank/card transactions that rules cannot classify.
- Scope can be the visible page, selected rows, or all company records. Each explicit request sends at most 50 rows. All-company scope has batch navigation; it does not send every record silently.
- Manual, reviewed, excluded, missing-source, transfer and already categorized rows are protected.
- Candidates and unresolved reasons appear in an editable preview. Only explicit Save persists category edits. Discard leaves the financial data unchanged.
- An uncertain purchase stays unclassified, with a reason. Merchant names alone do not establish purchase purpose, tax treatment or business use.

## Configuration And Privacy

Uses existing OCR/AI settings (`OPENAI_API_KEY`, `OCR_AI_MODEL`, or admin AI settings); no new dependency or separate key store.

Every request requires a fresh preview and explicit consent. The preview contains the exact outgoing payload and model. OpenAI receives masked descriptions, dates, amounts, direction, account kind and available category names. Files, private memos, account IDs, names and number fields are excluded. Masking is not full anonymization: descriptions may still contain personal or business information.

The provider endpoint is fixed, redirects are rejected, and `store: false` is sent. Shared company limits are 50 requests/day and a 15-second cooldown. An attempted request records only bounded usage/audit metadata, not a financial edit. Provider failures can still consume usage and incur provider costs.

Authorization, eligible data and category definitions are checked again before sending and after the response. Invalid refs, duplicate/missing results, unsupported categories, invented quotations or stale data reject the result. Structured output validation does not guarantee accounting correctness.

## Verification

```powershell
npm run test:banking
node --conditions=react-server --import tsx --test tests/*.test.ts
npm run lint
npm run build
```

For browser checks, generate a disposable fixture with:

```powershell
node --conditions=react-server --import tsx tests/prepare-banking-preview.ts --classification-ai
```

Use ONLY the generated temporary `DATA_DIR`, its local test session secret, `OPENAI_API_KEY=local-classification-mock-only` and `OCR_AI_MODEL=test-classification-model`. After a production build, preload `tests/mock-classification-provider.mjs` with Node's `--import` when starting the local Next server. The mock refuses non-temporary data directories or different credentials and labels its responses as test responses. Never preload it on production.

Browser coverage: visible/selected/all scopes, 50-row batch navigation, consent reset, candidate editing, unresolved reasons, discard, explicit save, candidate-free result closing, and missing-key guidance. Compare stored bank transactions/invoices/payments before and after preview: only usage/audit may change until Save.

These deterministic mock checks verify wiring and persistence safeguards, not real-model accuracy. No production financial data was sent to OpenAI during implementation verification. Validate real-model quality on approved data before relying on suggestions.

This change is not deployed by the implementation turn. Do not push main without a deployment request; main triggers Synology deployment.
