# Bank Account Category AI

## Behavior

### On-screen Predictions And Continuous List

- Eligible normal transactions without a saved category receive a read-only display candidate immediately. No provider request or financial write occurs merely by opening or scrolling the list.
- Labels: red `推測・要確認` for weak/no evidence, yellow `過去実績` for matching confirmed history, pale yellow `推定` for rules/keywords or medium/high AI confidence, blue `分類確定` only after explicit review. Text labels accompany color in both themes.
- Marking a red guess as reviewed requires an explicit acknowledgement (`acknowledgeGuess`); the workspace asks first and the saved reason keeps `推測候補を内容確認のうえ確定`. Income reconciled with an issued invoice gets a sales-category hint. See `docs/review-confidence-guard-2026-10-31.md`.
- Candidates always choose an available root category within the same company/office. If no valid category exists, show `有効な科目なし`; never invent a category or silently create a master record. Missing sources, transfers and excluded rows keep their existing treatment.
- Save is explicit. The save count includes loaded display candidates and edits, not unseen transactions. Saving a candidate preserves its confidence and reason without marking it confirmed. Confirmed history alone can teach subsequent predictions. Undo restores confidence together with classification.
- The list fetches 50 records at a time and automatically appends while scrolling, without a 50-row display ceiling or pagination. Selection and drafts span loaded rows. Desktop column headings stay visible in the scroll area; mobile retains the stacked view.
- Additional reads re-check authorization and the company data revision. Stale responses cannot append after refresh/save; changed source data requires refreshing rather than mixing snapshots. AI requests remain explicitly consented and capped at 50 transmitted rows per request, even when more rows are loaded (up to 10,000 selected IDs).
- Verification fixture: `node --conditions=react-server --import tsx tests/prepare-banking-preview.ts --classification-pages --classification-labels`.
- Verified 2026-10-27: 264 automated tests, full ESLint and production build passed. Isolated local browser checks at 390/820/1440px confirmed all four labels, no page overflow, 44px mobile controls, automatic 50 -> 100 -> 150 -> 162 row loading, SHIFT selection and draft retention, 158-row explicit save, red provenance after save and blue only on review. These checks used synthetic data; no production data or provider requests were used. Production release uses the existing main-branch Synology workflow; verify the exact commit and production recovery after restart.

- Existing automatic classification uses rules, confirmed exact-description history and a small built-in keyword list. It is not an AI model.
- The separate AI classification action proposes root account categories for unclassified bank/card transactions that rules cannot classify.
- Scope can be the visible page, selected rows, or all company records. Each explicit request sends at most 50 rows. All-company scope has batch navigation; it does not send every record silently.
- Manual, reviewed, excluded, missing-source, transfer and already categorized rows are protected.
- Every successfully processed AI row receives the closest available category, including low/unknown-confidence rows. The provider schema requires a non-null category reference for every row; missing, invalid or incomplete responses fail explicitly rather than appearing as successful unclassified results.
- Candidates and reasons appear in an editable preview. Low-confidence guesses are marked for review and counted separately. Only explicit Save persists category edits. Discard leaves the financial data unchanged.
- An uncertain purchase still receives a provisional category, but its explanation must identify assumptions or missing information. Merchant names alone do not establish purchase purpose, tax treatment or business use. Empty or fully masked descriptions may have empty evidence quotes only for low/unknown-confidence proposals. No records are automatically marked reviewed.

## Configuration And Privacy

Uses existing OCR/AI settings (`OPENAI_API_KEY`, `OCR_AI_MODEL`, or admin AI settings); no new dependency or separate key store.

Every request requires a fresh preview and explicit consent. The preview contains the exact outgoing payload and model. OpenAI receives masked descriptions, dates, amounts, direction, account kind and available category names. Files, private memos, account IDs, names and number fields are excluded. Masking is not full anonymization: descriptions may still contain personal or business information.

The provider endpoint is fixed, redirects are rejected, and `store: false` is sent. Shared company limits are 50 requests/day and a 15-second cooldown. An attempted request records only bounded usage/audit metadata, not a financial edit. Provider failures can still consume usage and incur provider costs.

Authorization, eligible data and category definitions are checked again before sending and after the response. A row with no available category in its company/office fails before sending. Invalid refs, null categories, duplicate/missing results, unsupported categories, invented quotations or stale data reject the result. Structured output validation does not guarantee accounting correctness.

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

Browser checks: visible/selected/all scopes, 50-row batch navigation, consent reset, a category on every AI result, low-confidence reasons, editing, discard, explicit save, and missing-key guidance. Compare stored bank transactions/invoices/payments before and after preview: only usage/audit may change until Save.

These deterministic mock checks verify wiring and persistence safeguards, not real-model accuracy. No production financial data was sent to OpenAI during implementation verification. Validate real-model quality on approved data before relying on suggestions.

Deploy only on an explicit request; pushing main triggers Synology deployment. Check the exact commit, completed build, restart and HTTPS response in addition to the Actions result.
