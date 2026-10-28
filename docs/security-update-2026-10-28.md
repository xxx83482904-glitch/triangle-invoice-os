# Security update 2026-10-28

During release verification, npm audit reported 10 affected packages: one critical, five high, three moderate and one low.

- Updated Next.js and eslint-config-next from 16.3.8 to 16.4.3.
- Applied compatible npm audit fixes without --force. This also updates Zod and vulnerable transitive packages.
- Next.js advisories: https://github.com/advisories/GHSA-2464-fhr4-w9xw and https://github.com/advisories/GHSA-p3m5-59mp-jv5r (patched from 16.4.1).
- Remaining npm audit result: 3 low-severity package warnings through deepmerge, @shadcn/registry and shadcn. The proposed forced shadcn downgrade is breaking and was not applied. These warnings are not resolved.
- The earlier braces warning count is historical, not a current clean bill of health; use the current audit output for this release.

Verification: 332 original-app tests and 9 China-isolation tests pass. Both application production builds and ESLint pass after the dependency update. Production business records and integration credentials are unchanged.
