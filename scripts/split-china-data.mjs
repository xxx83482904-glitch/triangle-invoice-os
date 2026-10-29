import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const migrationId = 'china-split-2026-10-29-v1';
const copy = (value) => structuredClone(value);
const digest = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const ids = (rows) => new Set(rows.map((row) => row.id));
const bankCollections = ['bankAccounts', 'bankTransactions', 'accountingCategories', 'bankRules', 'bankSyncStates', 'bankReconciliations', 'bankTransfers'];
const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);

function validateReferences(data) {
  const sets = Object.fromEntries(Object.entries(data).filter(([, value]) => Array.isArray(value)).map(([key, rows]) => [key, ids(rows)]));
  const ref = (row, field, collection, optional = false) => {
    if (!row[field] && optional) return;
    assert(sets[collection]?.has(row[field]), `Broken reference: ${row.id}.${field} -> ${collection}`);
  };
  for (const row of data.projects) { ref(row, 'clientId', 'clients'); ref(row, 'managerId', 'users'); for (const id of row.memberIds) assert(sets.users.has(id), `Unknown project member ${id}`); }
  for (const row of [...data.issuedInvoices, ...data.receivedInvoices, ...data.estimates]) ref(row, 'projectId', 'projects');
  for (const row of [...data.issuedInvoices, ...data.estimates]) ref(row, 'clientId', 'clients');
  for (const row of data.receivedInvoices) ref(row, 'vendorId', 'vendors');
  for (const row of data.issuedInvoiceItems) ref(row, 'invoiceId', 'issuedInvoices');
  for (const row of data.payments) { ref(row, 'issuedInvoiceId', 'issuedInvoices', true); ref(row, 'receivedInvoiceId', 'receivedInvoices', true); }
  for (const row of data.bankTransactions) { ref(row, 'bankAccountId', 'bankAccounts'); ref(row, 'categoryId', 'accountingCategories', true); ref(row, 'subCategoryId', 'accountingCategories', true); }
  for (const row of data.bankRules) { ref(row, 'bankAccountId', 'bankAccounts', true); ref(row, 'categoryId', 'accountingCategories', true); ref(row, 'subCategoryId', 'accountingCategories', true); }
  for (const row of data.bankReconciliations) { ref(row, 'transactionId', 'bankTransactions'); ref(row, 'invoiceId', row.invoiceKind === 'issued' ? 'issuedInvoices' : 'receivedInvoices'); ref(row, 'paymentId', 'payments'); }
  for (const row of data.bankTransfers || []) { ref(row, 'outgoingId', 'bankTransactions'); ref(row, 'incomingId', 'bankTransactions'); }
}

function mergeRows(existing, incoming, key) {
  const result = copy(existing || []);
  const byId = new Map(result.map((row) => [row.id, row]));
  for (const row of incoming) {
    if (byId.has(row.id)) assert.deepEqual(byId.get(row.id), row, `Target conflict in ${key}: ${row.id}`);
    else { result.push(copy(row)); byId.set(row.id, row); }
  }
  return result;
}

export function planSplit(source, target) {
  assert.equal(target.appEdition, 'CHINA', 'Destination must be the independent China application');
  assert.notEqual(source.appEdition, 'CHINA', 'Source and destination editions must differ');
  assert(!target.mailDocuments.length && !target.mailFolders.length, 'China postal storage must be empty');
  if (source.companySplitMigration?.id === migrationId) {
    assert.equal(target.companySplitMigration?.id, migrationId, 'Incomplete prior migration');
    return { alreadyApplied: true, report: { id: migrationId, alreadyApplied: true } };
  }
  assert(!target.companySplitMigration, 'Unexpected destination migration marker');
  const japan = copy(source), china = copy(target), selected = {};
  const chinaProjects = source.projects.filter((row) => row.company !== 'JAPAN');
  const projectIds = ids(chinaProjects);
  selected.projects = chinaProjects;
  selected.clients = source.clients.filter((row) => row.company === 'CHINA' || (!row.company && row.id !== 'cli-japan'));
  selected.vendors = source.vendors.filter((row) => row.company !== 'JAPAN');
  for (const key of ['estimates', 'issuedInvoices', 'receivedInvoices']) selected[key] = (source[key] || []).filter((row) => projectIds.has(row.projectId));
  const issuedIds = ids(selected.issuedInvoices), receivedIds = ids(selected.receivedInvoices);
  selected.issuedInvoiceItems = source.issuedInvoiceItems.filter((row) => issuedIds.has(row.invoiceId));
  selected.payments = source.payments.filter((row) => issuedIds.has(row.issuedInvoiceId) || receivedIds.has(row.receivedInvoiceId));
  for (const key of bankCollections) selected[key] = (source[key] || []).filter((row) => row.company === 'CHINA');
  const legacyMail = source.mailDocuments.filter((row) => row.company === 'CHINA');
  // Postal editing is Japan-only. Active legacy mail needs a separate explicit conversion, never silent loss.
  assert(legacyMail.every((row) => row.deletedAt), 'Active Chinese mail needs document conversion before migration');
  const legacyFolders = source.mailFolders.filter((row) => row.company === 'CHINA');
  const ownedIds = new Set([...Object.values(selected).flat().map((row) => row.id), ...legacyMail.map((row) => row.id), ...legacyFolders.map((row) => row.id)]);
  selected.attachments = source.attachments.filter((row) => ownedIds.has(row.relatedId));
  for (const row of selected.attachments) ownedIds.add(row.id);

  const userMap = new Map();
  const remapUser = (id) => {
    if (!id) return id;
    if (userMap.has(id)) return userMap.get(id);
    const user = source.users.find((row) => row.id === id);
    const destination = target.users.find((row) => user && row.email.toLowerCase() === user.email.toLowerCase() && !row.deletedAt && row.accessStatus !== 'REJECTED' && row.accessStatus !== 'PENDING');
    assert(destination, `No existing China user for source user ${id}; credentials will not be copied`);
    userMap.set(id, destination.id);
    return destination.id;
  };
  for (const [key, rows] of Object.entries(selected)) {
    const removed = ids(rows);
    japan[key] = (source[key] || []).filter((row) => !removed.has(row.id));
    const imported = rows.map((original) => {
      const row = copy(original);
      if (['projects', 'clients', 'vendors', ...bankCollections].includes(key)) row.company = 'CHINA';
      for (const field of ['managerId', 'createdById', 'uploadedById', 'approvedById', 'confirmedById']) if (row[field]) row[field] = remapUser(row[field]);
      if (row.memberIds) row.memberIds = row.memberIds.map(remapUser);
      if (key === 'bankSyncStates') { row.autoSync = false; row.status = row.status === 'RUNNING' ? 'IDLE' : row.status; delete row.runId; }
      return row;
    });
    china[key] = mergeRows(target[key], imported, key);
  }
  japan.mailDocuments = source.mailDocuments.filter((row) => row.company !== 'CHINA');
  japan.mailFolders = source.mailFolders.filter((row) => row.company !== 'CHINA');
  japan.selectOptions = source.selectOptions.filter((row) => row.company !== 'CHINA');
  for (const row of source.selectOptions.filter((row) => row.company !== 'JAPAN')) {
    const existing = china.selectOptions.find((item) => item.id === row.id);
    if (existing) {
      assert.equal(existing.group, row.group, 'Option identifier conflict');
      assert.equal(existing.value, row.value, 'Option value conflict');
      // Shared legacy status captions are rendered by the current application labels.
      if (row.company === 'CHINA') assert.deepEqual(existing, row, 'Explicit China option conflict');
    } else china.selectOptions.push(copy(row));
  }
  const auditMetadata = (value) => { const row = copy(value); delete row.beforeJson; delete row.afterJson; delete row.beforeStateJson; return row; };
  japan.auditLogs = source.auditLogs.filter((row) => !ownedIds.has(row.targetId)).map(auditMetadata);
  const chinaAudit = source.auditLogs.filter((row) => ownedIds.has(row.targetId)).map((row) => ({ ...auditMetadata(row), userId: remapUser(row.userId) }));
  china.auditLogs = mergeRows(target.auditLogs, chinaAudit, 'auditLogs');
  japan.bankAiUsage = { ...source.bankAiUsage }; delete japan.bankAiUsage.CHINA;
  if (source.bankAiUsage?.CHINA) china.bankAiUsage = { ...target.bankAiUsage, CHINA: copy(source.bankAiUsage.CHINA) };
  japan.appEdition = 'JAPAN';
  const counts = Object.fromEntries(Object.entries(selected).map(([key, rows]) => [key, { total: rows.length, active: rows.filter((row) => !row.deletedAt).length }]));
  const totals = { contractAmount: sum(selected.projects, 'contractAmount'), issued: sum(selected.issuedInvoices, 'total'), received: sum(selected.receivedInvoices, 'total'), payments: sum(selected.payments, 'amount'), bankTransactions: sum(selected.bankTransactions, 'amount') };
  const japanRetained = Object.fromEntries(Object.keys(selected).map((key) => [key, { count: japan[key].length, hash: digest(japan[key]), amount: sum(japan[key], 'total'), bankAmount: sum(japan[key], 'amount') }]));
  const report = { id: migrationId, counts, totals, japanRetained, archivedMail: legacyMail.length, archivedFolders: legacyFolders.length, userMap: Object.fromEntries(userMap), sourceHash: digest(source), targetHash: digest(target), undoReset: true };
  japan.companySplitMigration = { id: migrationId, destination: 'invoice-cn.kuremasato.com' };
  china.companySplitMigration = { id: migrationId, source: 'invoice.kuremasato.com', counts, totals };
  for (const data of [japan, china]) {
    for (const key of ['projects', 'clients', 'vendors', ...bankCollections]) assert((data[key] || []).every((row) => row.company === data.appEdition), `Cross-company row remains: ${key}`);
    validateReferences(data);
  }
  assert.deepEqual(japan.users, source.users, 'Source credentials changed');
  assert.deepEqual(china.users, target.users, 'Destination credentials changed');
  const fileRefs = [];
  for (const row of [...Object.values(selected).flat(), ...legacyMail]) {
    for (const field of ['fileUrl', 'contractFileUrl', 'pdfUrl']) {
      const url = row[field];
      if (!url) continue;
      const parsed = new URL(url, 'https://invoice.kuremasato.com');
      assert(['invoice.kuremasato.com', 'invoice-cn.kuremasato.com'].includes(parsed.hostname), `External document requires manual review: ${row.id}`);
      if (/^\/api\/(issued-invoices|estimates)\//.test(parsed.pathname)) continue;
      assert(/^\/(uploads\/received-invoices|api\/files)\/[^/]+$/.test(parsed.pathname), `Unknown document path: ${row.id}`);
      const name = decodeURIComponent(path.posix.basename(parsed.pathname));
      assert(name && name !== '.' && name !== '..' && !/[\\/\0]/.test(name), 'Unsafe attachment name');
      fileRefs.push({ name, required: !row.deletedAt });
    }
  }
  const files = [...new Set(fileRefs.map((row) => row.name))].map((name) => ({ name, required: fileRefs.some((row) => row.name === name && row.required) }));
  return { japan, china, report, files, legacyArchive: { mailDocuments: legacyMail, mailFolders: legacyFolders, sourceAudit: source.auditLogs.filter((row) => ownedIds.has(row.targetId)).map(auditMetadata), selectOptions: source.selectOptions.filter((row) => row.company !== 'JAPAN') } };
}

function safeFile(root, name) {
  const file = path.resolve(root, name);
  assert(file.startsWith(`${path.resolve(root)}${path.sep}`), 'Path escaped its root');
  if (fs.existsSync(file)) assert(!fs.lstatSync(file).isSymbolicLink(), 'Symlink data is not supported');
  return file;
}

function atomicJson(file, value, owner) {
  const temp = `${file}.${migrationId}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', owner.mode & 0o777);
  try {
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); if (process.platform !== 'win32') fs.fchownSync(fd, owner.uid, owner.gid); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}

export function migrateFiles({ sourceFile, targetFile, sourceUploads, targetUploads, backupRoot, apply = false }) {
  for (const file of [sourceFile, targetFile]) assert(!fs.lstatSync(file).isSymbolicLink(), 'Symlink data is not supported');
  const sourceBytes = fs.readFileSync(sourceFile), targetBytes = fs.readFileSync(targetFile);
  const source = JSON.parse(sourceBytes), target = JSON.parse(targetBytes);
  const plan = planSplit(source, target);
  if (plan.alreadyApplied) return plan.report;
  const missingDeletedFiles = [], verifiedFiles = [];
  for (const row of plan.files) {
    const file = safeFile(sourceUploads, row.name), destination = safeFile(targetUploads, row.name);
    if (!fs.existsSync(file)) { assert(!row.required, `Active attachment is missing: ${row.name}`); missingDeletedFiles.push(row.name); continue; }
    const bytes = fs.readFileSync(file), hash = digest(bytes);
    if (fs.existsSync(destination)) assert.equal(digest(fs.readFileSync(destination)), hash, `Destination file conflict: ${row.name}`);
    verifiedFiles.push({ ...row, hash, size: bytes.length });
  }
  const report = { ...plan.report, verifiedFiles, missingDeletedFiles, applied: false };
  if (!apply) return report;
  assert(!fs.existsSync(backupRoot), 'Backup path already exists; inspect prior run before retrying');
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(backupRoot, 'japan-before.json'), sourceBytes, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(backupRoot, 'china-before.json'), targetBytes, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(backupRoot, 'china-legacy-archive.json'), JSON.stringify(plan.legacyArchive, null, 2), { flag: 'wx', mode: 0o600 });
  const sourceStat = fs.statSync(sourceFile), targetStat = fs.statSync(targetFile);
  assert.equal(digest(fs.readFileSync(sourceFile)), digest(sourceBytes), 'Source changed during preparation');
  assert.equal(digest(fs.readFileSync(targetFile)), digest(targetBytes), 'Destination changed during preparation');
  fs.mkdirSync(targetUploads, { recursive: true });
  for (const row of verifiedFiles) {
    const destination = safeFile(targetUploads, row.name);
    if (!fs.existsSync(destination)) { fs.copyFileSync(safeFile(sourceUploads, row.name), destination, fs.constants.COPYFILE_EXCL); fs.chmodSync(destination, 0o640); if (process.platform !== 'win32') fs.chownSync(destination, targetStat.uid, targetStat.gid); }
    assert.equal(digest(fs.readFileSync(destination)), row.hash, `Copied file verification failed: ${row.name}`);
  }
  try {
    atomicJson(targetFile, plan.china, targetStat);
    assert.deepEqual(JSON.parse(fs.readFileSync(targetFile)), plan.china);
    atomicJson(sourceFile, plan.japan, sourceStat);
    assert.deepEqual(JSON.parse(fs.readFileSync(sourceFile)), plan.japan);
  } catch (error) {
    atomicJson(targetFile, target, targetStat);
    atomicJson(sourceFile, source, sourceStat);
    throw error;
  }
  report.applied = true;
  report.japanAfterHash = digest(fs.readFileSync(sourceFile)); report.chinaAfterHash = digest(fs.readFileSync(targetFile));
  fs.writeFileSync(path.join(backupRoot, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), get = (name) => args[args.indexOf(name) + 1];
  for (const name of ['--source', '--target', '--source-uploads', '--target-uploads', '--backup']) assert(args.includes(name) && get(name) && !get(name).startsWith('--'), `Missing ${name}`);
  const result = migrateFiles({ sourceFile: get('--source'), targetFile: get('--target'), sourceUploads: get('--source-uploads'), targetUploads: get('--target-uploads'), backupRoot: get('--backup'), apply: args.includes('--apply') });
  console.log(JSON.stringify(result, null, 2));
}
