# Japan / China Data Separation

## Deployment Order

Do not deploy the Japan-only storage guard onto a mixed-company data file.
Complete the migration first, verify both applications, then deploy Japan.

- Japan: https://invoice.kuremasato.com, container `triangle-invoice-os`.
- China: https://invoice-cn.kuremasato.com, container `triangle-invoice-china`.
- Japan data: `/volume1/docker/triangle-invoice-os/data/app-data.json`.
- Japan uploads: `/volume1/docker/triangle-invoice-os/uploads`.
- China data: named volume `triangle-invoice-china-data`, `/app/data-china`.
- Migration ID: `china-split-2026-10-29-v1`.

## Approved Operation

The user approved a one-time administrator task that stops only these two
containers, backs up both data files, moves Chinese records and related files,
and restarts both applications. Other applications and authentication settings
must not change.

Upload `scripts/split-china-data.mjs` and
`deploy/synology/run-china-migration.sh` into
`/volume1/docker/triangle-invoice-os-china/`. Create a disabled scheduled root
task named `China data migration 20261029` with this command:

```sh
/bin/sh /volume1/docker/triangle-invoice-os-china/run-china-migration.sh
```

Run it manually once. The wrapper checks the exact running containers and their
mounts, then runs the migration in the existing China image without networking.
It restarts the stopped containers on both success and failure.

## Backups and Verification

Private backup directory:
`/volume1/docker/triangle-invoice-os-china/migration-backups/china-split-2026-10-29-v1`.

- `japan-before.json`: complete original Japanese / mixed data and audit history.
- `china-before.json`: complete original independent China data.
- `china-legacy-archive.json`: deleted Chinese mail and related legacy metadata.
- `report.json`: migrated counts, amounts, retained Japan hashes, file hashes.
- Operator log: `/volume1/docker/triangle-invoice-os-china/china-migration.log`.

These backups contain private data and credentials. Keep them private; never
commit, publish, or upload them to another service. Original source uploads are
retained, and referenced files are copied and SHA-256 verified in China.

Preflight expected 12 Chinese projects, 2 clients, 3 vendors, 2 deleted received
invoices, 2 deleted attachments, and 3 deleted postal records. There were no
Chinese issued invoices, estimates, payments, or bank transactions. Japan must
retain all 10,437 bank transactions. Final counts must come from the actual run.

Deleted documents remain deleted. Chinese postal records are archived rather
than enabled in the China application, where postal sorting is unsupported.
Old Undo snapshots are removed from the live stores to prevent a restore from
reintroducing the mixed-company state; complete history remains in the backup.
User references are mapped to existing China users by email; passwords, session
secrets, issuer settings, bank details, API keys, and Japanese seals are not copied.

The migration rejects conflicting destination IDs/files and broken references.
A completed migration is an idempotent no-op on retry. A failed run with an
existing backup directory requires inspection before any retry; never delete or
overwrite its backup to force execution.

## Application Guard

Japan offers only the Japan company option. Old `company=CHINA` page links
redirect to Japan and clear company-specific record filters; API/write requests
with that query are rejected. Server permissions and the storage guard also
reject Chinese access/data, independently of the navigation display.
The Japan migration marker prevents legacy mixed data files from replacing the
migrated live file during startup. China remains an independent deployment.

## Execution Status

Production migration ran on 2026-10-29, starting at 01:34:15 UTC. The report
confirms `applied: true`: 12 projects, 2 clients, 3 vendors, 2 deleted received
invoices and 2 deleted attachments moved; 3 deleted mail records were archived.
Japan retained 25 projects, 10 clients, 19 vendors, 23 issued invoices, 78 received
invoices, 50 payment records, 17 bank accounts and all 10,437 bank transactions.

Three files referenced only by deleted records were already absent from the
source uploads. No missing active file was accepted. These missing originals
cannot be recovered by this migration; their references are retained in the
private archive and migration report.

DSM reported successful task completion (exit 0) at 2026-10-29 10:39:28 JST.
China HTTPS login and its 12 active projects were verified after restart.
Japan HTTPS returned 200 after startup. Its downloaded live file exactly
matched the migration report's SHA-256, contained zero Chinese scoped records,
and retained every reported Japan collection hash. Existing Japan credentials
also matched the preflight snapshot. The Japan-only code deployment follows.
Local verification passed 335 TypeScript tests, 6 migration tests, ESLint and
the Next.js production build.
