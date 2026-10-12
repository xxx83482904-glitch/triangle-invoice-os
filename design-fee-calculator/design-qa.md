# Design and interaction QA — 2026-10-12

final result: passed

## Visual grounding

- Existing code context: `../src/app/idea-os/idea-os-app.tsx` (letter-spaced TRIANGLE branding, square controls, thin rules); `../src/app/globals.css` (sans-serif typography).
- Company reference: https://the-triangle.jp/ ; screenshot `docs/screenshots/brand-reference.jpg`.
- The user's explicit white/black, minimal, large-amount, no-chart brief governs the calculator. The marketing site's yellow animations and portfolio imagery are outside this utility's scope. This is a new calculator layout within the existing product context; brand compatibility was assessed rather than pixel fidelity to a calculator mockup.
- Desktop state: default 6,300㎡, retail, no additional fee, Japanese, disclosures closed. `docs/screenshots/desktop-ja.jpg` (full page), `desktop-preview.jpg` (viewport).
- Mobile states: `mobile-ja.jpg` (390×844 CSS viewport, default), `mobile-320.jpg` (320×740 CSS viewport, default), `mobile-zh.jpg` (390×844 CSS viewport, 1,800㎡, residential 1.07, 25,000 RMB extra, breakdown open).
- Tablet: 768×1024 CSS viewport inspected directly.
- All screenshots are unframed browser captures at native tool density. No device-frame mockup or density-rescaled comparison was used. Full page captures contain the same CSS-width layout with extended height. See `docs/screenshots/dimensions.json` for captured pixel dimensions.

## Findings and fixes

- **P2, fixed:** At 320px on a browser with a 15px scrollbar, the body's minimum width caused horizontal overflow. Removed the fixed minimum width. Rechecked: document client/scroll widths both 305px. At 390 and 768, client and scroll widths also match.
- No remaining P0/P1/P2 findings in the tested flows.

## Required visual surfaces

- **Typography:** Sans-serif Latin and CJK fallbacks, restrained brand tracking, tabular numbers, distinct large total, explicit RMB/㎡ labels. Financial figures are readable on desktop and mobile; CJK text wraps naturally. Small-screen inputs are 16px.
- **Spacing/layout:** Two-column form/result on desktop and tablet; single column on mobile. Aligned result rows and right-aligned numeric table columns. Square controls, consistent 44–48px touch heights, light separators. Inspected the full mobile page to confirm all 13 simulation rows, footer, and disclosures remain within width.
- **Color/tokens:** White background, near-black principal type, gray secondary text, subtle gray current-area row. Red is reserved for validation errors. No graphs, visual clutter, or decorative imagery.
- **Assets:** Product name is live text; standard Lucide interface icons. No generated illustrations are required. Brand identity is carried by text, typography, and spacing.
- **Copy/content:** Japanese and simplified Chinese terminology checked. Result/copy paths use average from base fee only. Both models' minimum rules are distinguished. Above 13,700㎡ the legacy amount/difference is unavailable. The revised model remains available.

## Interaction evidence

- Initial result 4,143,000 RMB, average 657.6 RMB/㎡, zero extra.
- Legacy disclosure: 4,158,000 RMB; difference −15,000 RMB.
- 151㎡ office +5,000 RMB: revised base 240,000, total 245,000; legacy total 201,267. Simulation excludes extra.
- 14,000㎡: revised calculation succeeds; legacy displays undefined instead of extrapolating.
- Chinese 1,800㎡ residential +25,000: base 1,479,810; total 1,504,810; average 822.1. Breakdown confirms 240,000 + 945,000 + 198,000 before coefficient.
- Empty area, zero, alphabetic input, and negative additional fee: inline error, totals cleared, export buttons disabled.
- All four copy controls clicked and actual browser clipboard contents checked: result, Chinese quotation, 13-row comparison, 14-line/3-column TSV including header.
- Browser console error/warning log empty.
- Unit tests cover blocked Clipboard API and legacy copy failure; manual fallback is a native dialog with selectable text and explicit close/select buttons.

## Accessibility and code review

- Associated labels, native select/details/dialog, explicit button types, language toggle pressed state, document lang update, keyboard focus outlines.
- Invalid controls carry `aria-invalid` and described errors; result and copy feedback use polite live regions.
- Monetary arithmetic lives outside React. Effects are limited to document language, toast timeout, and dialog focus. No server requests, authentication, or third-party runtime scripts. Long simulations are paginated.
- React best-practices review completed for state ownership, pure derived values, stable row keys, cleanup, and accessible inputs.

## Checks and remaining verification limits

- 111 automated tests passed, including all 26 reference totals and 80,000 monotonicity samples across four project types.
- TypeScript and Vite production build passed.
- Browser responsiveness verified at 320, 390, 768, and 1280 CSS px. iPhone physical hardware/Safari, actual NAS Web Station, and live Vercel hosting were not tested.
- No remaining P3 changes are required for the requested scope.
