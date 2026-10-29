# Shared workspace interface

Date: 2026-10-29
Status: implemented and verified locally; Japan deployment requested and pending.

## Design baseline

Extend the approved banking ledger interface to the rest of the application:

- One role-aware horizontal desktop navigation and full-width workspace.
- Existing mobile navigation remains available, with the same destinations and permissions.
- Shared neutral light/dark colors, compact headings, restrained table styling,
  wrapping tabs, visible selection, and consistent focus treatment.
- Page sections are unframed bands; framed cards remain appropriate for individual
  summaries, dialogs, and tools. Projects, project detail, receiving, partners,
  payments, reports, and the guest workspace use section variants.
- Issued invoices and estimates share wrapping month navigation.
- Estimates and issued invoices share the bottom Save All / reset control.
- Invoice original-review status uses the same review tag as bank transactions.
  Select rows, then use Confirm or Reset to unreviewed; Save All persists drafts.
  A single invoice can also be reviewed from its detail editor.
- Review does not mean paid, sent, classified, reconciled, or approved. Existing
  financial status rules, role checks, and server actions remain unchanged.
- The shared palette also applies to portal dialogs and authentication pages.
  Registration now includes the same theme switch as login.

## Verification

Only synthetic local data under tmp/category-picker-data was used. No production
records, Synology configuration, external integrations, or China deployment changed.

- TypeScript: npx tsc --noEmit passed.
- ESLint: npm run lint passed.
- Existing regression suite: 345 tests passed, no failures, using
  node --conditions=react-server --import tsx --test tests/*.test.ts.
- Production compilation and standalone asset copy: npm run build passed.
- Standalone local preview: http://127.0.0.1:3041.
- Main routes checked at 1440x1024, 820x1180, and 390x844: dashboard, documents,
  projects, estimates, issued-invoices, mail-sorter, received-invoices,
  banking/accounts, payments, reports, partners, and users.
- Banking detail, reconciliation, AI checks, insights, forecast, and project
  detail were also checked at those three sizes.
- No document-level horizontal overflow or application error in those checks.
  Wide data tables retain their internal horizontal scrolling on narrow screens.
- Light and dark screenshots inspected. Login and registration checked at desktop
  and mobile widths; invoice creation dialog inspected without submitting it.
- Production standalone build rechecked on all 18 main views at 1280px; no
  browser console errors. Development-only stale Card-module hydration warnings
  disappeared in the clean production build.
- Shift-click selected both fixture invoices. Confirm showed blue review tags
  and unsaved indicators without writing the fixture. Reset restored the draft.
- On the standalone build, Save All persisted both reviews. Both invoice statuses
  remained DRAFT. Reset to unreviewed and Save All restored the original review
  state, verified directly in the fixture JSON.
- Existing automated tests cover restricted navigation, company isolation,
  selection gestures, atomic saves, and payment/status invariants.

## Limits

- Screenshots use synthetic data, not a complete production dataset.
- Guest-role UI and every permission-specific form were not browser-tested;
  their shared styling is implemented and permission logic is unchanged.
- External OCR, banking synchronization, AI calls, file uploads, and production
  deployment were not exercised as part of this UI-only change.
- Screenshots and disposable fixture data are in untracked tmp/; do not commit
  that directory or the unrelated docs/ui-ux-changes.md.
