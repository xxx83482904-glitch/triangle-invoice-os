# Banking Ledger Design QA

Date: 2026-10-29

final result: passed

## Scope and Evidence

- Source visual truth: `C:/Users/kure/.codex/generated_images/019e912a-0c8f-7843-9f84-4b1d020d3af6/exec-aec983d9-6035-4798-96ca-1a900f843b6a.png`
- Implementation: `http://127.0.0.1:3041/banking?company=JAPAN&month=2026-10&sort=date-desc&page=1`
- Light screenshot: `C:/Users/kure/Desktop/triangle-invoice-os/tmp/bank-ledger-light-desktop.png`
- Dark screenshot: `C:/Users/kure/Desktop/triangle-invoice-os/tmp/bank-ledger-dark-desktop.png`
- Tablet screenshot: `C:/Users/kure/Desktop/triangle-invoice-os/tmp/bank-ledger-tablet-panel.png`
- Mobile screenshot: `C:/Users/kure/Desktop/triangle-invoice-os/tmp/bank-ledger-mobile-panel.png`
- Scope is the banking detail screen. Other screens retain their existing shell. No deployment, production data changes, authentication changes, or external bank/AI calls.
- Browser testing used a separate DATA_DIR, `tmp/category-picker-data`, containing 65 synthetic transactions. Final screenshots show three selected rows, saved and unreviewed tags, and no unsaved drafts.

## Comparison Setup

- Source pixels: 1487 x 1058. Generated mockup has no authoritative CSS viewport or device scale.
- Desktop CSS viewport: 1440 x 1024; devicePixelRatio: 1. Captured image pixels: 1425 x 1013, as returned by the in-app browser capture. These are not 2x captures.
- Comparison was proportional to content width: the source at 1425/1487 scale is approximately 1425 x 1014, matching the captured aspect ratio to within one pixel. Browser capture scaling/scrollbar differences were not treated as design defects. DOM measurements used CSS pixels.
- Source, final light capture, and final dark capture were opened together in the same comparison input. The light image is the fidelity target; dark is a requested adaptation with identical structure.
- Full-view composition, header, month strip, selected rows, confirmation tags, category rail, and save bar were examined in the original-resolution images. The important labels and icons were readable there, so separate cropped comparisons were unnecessary.
- Source example data and final fixture data differ: mock selection totals -6,600, final selection totals -8,800. The fixture preserves the real category catalog instead of replacing it with the mock's abbreviated list. These are intentional content differences, not pixel fidelity claims.

## Findings and Comparison History

No actionable P0/P1/P2 findings remain in the tested states.

1. Initial P2: stacked summary/navigation and verbose row controls made the ledger less dense than the source. Fixed by sharing the workflow/summary line, shortening the reconciliation action with a descriptive title, moving source notes to an accessible popover, and tightening desktop row controls. Post-fix desktop screenshots show about nine rows and a balanced table/rail composition.
2. Initial P2: short desktop heights needed a reliable scroll/save boundary. Fixed using bounded table scrolling, a fixed save bar, and bottom content padding. At 1440 x 1024 the table ends at y=944 and the save bar starts at y=960. At 1280 x 800 the table ends at y=731 and the save bar starts at y=736. Neither state has horizontal page overflow or hidden table columns.
3. Responsive adaptation: below 1280px, the category and bulk-review panel becomes a drawer. Tested at 820 x 1180 and 390 x 844. No horizontal page overflow; visible mobile drawer buttons meet 44 x 44 minimum targets. Drawer heading was subsequently aligned with the command label.
4. Dark adaptation: neutral charcoal surfaces, readable muted text, blue selection/review states, and preserved classification colors. Final dark screenshot was compared with the same light composition. No missing controls or persistent light-theme surfaces in the ledger.

## Required Fidelity Surfaces

- Fonts and typography: retained the app's Geist/system Japanese fallback stack. The generated source has no reliable font metadata. Compact 12-14px UI text, 20px heading, tabular amounts, zero letter spacing, and wrapping category labels preserve the source hierarchy without attempting to reproduce generated text artifacts.
- Spacing and layout: full-width horizontal navigation, 20px desktop gutters, 16px column gap, 330/360px right rail, separate date and review columns, compact row heights, and a persistent save bar. No decorative page cards or nested cards were added.
- Colors and tokens: white/neutral light theme; neutral dark background with higher-contrast muted text. Blue is reserved for active/selected/confirmed UI, while existing classification badges preserve their semantic palette. Both themes use the same geometry.
- Image quality and assets: kept the app's existing TRIANGLE brand rather than adopting the generated mockup's invented logo. No new illustration or custom SVG substitute was introduced. Tool icons use Lucide; the existing identity is an intentional integration constraint.
- Copy and content: one row selection checkbox, readable review tags, a bulk confirmation command, and explicit Save All. Existing sync status, classification commands, account filters, all-period access, reconciliation, and unsaved-change warnings remain available.
- Accessibility: labelled controls, existing keyboard-aware selection, focus outlines, disabled pending actions, mobile hit targets, and textual status in addition to color. Full screen-reader and OS-level text zoom audits were not performed.

## Interaction Verification

- Shift selection selected rows 1-3; Ctrl deselection removed only row 2. Signed selected sums were -6,600 and then -4,400.
- Bulk confirmation changed tags and created two drafts without writing the fixture file. Explicit Save All changed exactly those two records; the intervening row stayed untouched.
- Reset to unreviewed and re-confirm both worked. Navigating with drafts raised the existing unsaved-change dialog; cancel retained the edits.
- Tablet category search selected a supplementary category for three rows, preserved selection, and reset their review state. Mobile bulk confirmation followed by Save All persisted exactly those three category/review changes.
- Review-state filtering returned the three saved confirmed rows. An empty November displayed zero records and disabled Save All. Returning to October restored the populated list.
- Source-note popover opened and closed using Escape.
- Infinite scrolling loaded all 65/65 rows and retained selection.
- Theme switching preserved the working layout. Temporary viewport overrides were reset after testing.
- Console errors checked: an intermediate missing-popover-module development error was fixed; there were no new errors after 09:19 UTC during the final flows.

## Automated Verification

- Production build: passed.
- TypeScript: `npx tsc --noEmit` passed.
- ESLint: touched banking, shell, navigation, popover, helper and test files passed.
- Banking regression suite: 147 passed.
- Ledger, category catalog, list selection, and navigation tests: 28 passed.
- `git diff --check`: passed (only existing Windows line-ending warnings).

## Implementation Checklist

- [x] Desktop ledger and right category catalog integrated with existing application logic.
- [x] Confirmation tags and draft-only bulk confirmation, with explicit persistence.
- [x] Light and dark themes, desktop/tablet/mobile verification.
- [x] Selection, scrolling, category editing, filters, and unsaved guards checked.
- [x] Existing role navigation and non-banking shell preserved.
- [x] Local preview retained; production not deployed.

Residual scope: live Money Forward synchronization, paid external AI classification, production concurrency, and full application-wide visual regression were not exercised in this UI task. Existing backend tests cover the associated guards; no claim of a full production audit is made.
