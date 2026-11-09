import assert from "node:assert/strict";
import test from "node:test";
import { memberFeatures, effectiveFeatures, effectivePermissions, normalizeFeatureAccess, roleHasFeature, type FeatureAccess } from "../src/lib/member-features";
import { can, canRole, assertCan, defaultPathForRole } from "../src/lib/rbac";
import { canAccessPath, defaultPathForUser, navigationGroups, pathForUser, sidebarNavigation, commandNavigation, mobileNavigation, workflowNavigation } from "../src/lib/app-navigation";
import { agentCan, agentScopeList, generateAgentTokenSecret, issueAgentToken, verifyAgentToken } from "../src/lib/agent-tokens";
import { agentBatchSchema, assertAgentOperationAccess, listAgentResource, runAgentOperations } from "../src/lib/agent-api";
import { canViewDocumentFile } from "../src/lib/document-file-access";
import { documentRows, visibleProjects } from "../src/lib/documents";
import { sectionExport } from "../src/lib/section-export";
import { applyIssuedInvoiceEdits } from "../src/lib/issued-invoice-edits";
import type { User, UserRole } from "../src/lib/types";
import { admin, fixture, timestamp } from "./document-fixture";

// Frozen pre-feature role lists from Batch 01, independent of the permission implementation.
const originalPermissions = {
  ADMIN: [
    "submit:expenses",
    "manage:expenses",
    "view:documents",
    "view:dashboard",
    "view:projects",
    "view:mailSorter",
    "view:issuedInvoices",
    "view:receivedInvoices",
    "view:payments",
    "view:banking",
    "manage:banking",
    "view:partners",
    "view:reports",
    "manage:users",
    "manage:settings",
    "manage:clients",
    "manage:vendors",
    "manage:projects",
    "manage:issuedInvoices",
    "manage:incomePayments",
    "manage:mailSorter",
    "manage:receivedInvoices",
    "view:imports",
    "manage:imports",
    "manage:expensePayments",
    "export:csv",
    "undo:changes",
    "view:all",
  ],
  ACCOUNTING: [
    "submit:expenses",
    "manage:expenses",
    "view:documents",
    "view:dashboard",
    "view:projects",
    "view:mailSorter",
    "view:issuedInvoices",
    "view:receivedInvoices",
    "view:payments",
    "view:banking",
    "manage:banking",
    "view:partners",
    "view:reports",
    "manage:clients",
    "manage:vendors",
    "manage:projects",
    "manage:issuedInvoices",
    "manage:incomePayments",
    "manage:mailSorter",
    "manage:receivedInvoices",
    "view:imports",
    "manage:imports",
    "manage:expensePayments",
    "export:csv",
    "undo:changes",
    "view:all",
  ],
  CHIEF_DESIGNER: [
    "submit:expenses",
    "view:documents",
    "view:projects",
    "view:receivedInvoices",
    "view:imports",
    "view:assigned",
    "approve:receivedInvoices",
    "upload:receivedInvoices",
    "comment:project",
  ],
  PROJECT_MANAGER: [
    "submit:expenses",
    "view:documents",
    "view:projects",
    "view:issuedInvoices",
    "view:assigned",
    "manage:clients",
    "manage:projects",
    "manage:issuedInvoices",
    "comment:project",
  ],
  MAIL_EDITOR: ["view:documents", "view:mailSorter", "manage:mailSorter", "submit:expenses"],
  BILLING_EDITOR: ["view:issuedInvoices", "manage:issuedInvoices", "view:partners", "manage:clients", "create:invoiceProjects", "export:issuedInvoices"],
  DESIGNER: ["view:assigned", "upload:receivedInvoices", "comment:project", "submit:expenses"],
  GUEST: ["guest:createIssuedInvoices"],
} satisfies Record<UserRole, string[]>;

const roles = Object.keys(originalPermissions) as UserRole[];
const roleBound = ["manage:users", "manage:settings", "undo:changes", "view:all", "view:assigned", "guest:createIssuedInvoices"];
const allStates = (value: boolean): FeatureAccess => Object.fromEntries(memberFeatures.map(({ key }) => [key, value]));
const sorted = (values: Iterable<string>) => [...values].sort();
const originalPaths: Record<UserRole, string[]> = {
  ADMIN: ["/dashboard", "/banking", "/documents", "/projects", "/estimates", "/issued-invoices", "/mail-sorter", "/received-invoices", "/imports", "/payments", "/expenses", "/reports", "/partners", "/users"],
  ACCOUNTING: ["/dashboard", "/banking", "/documents", "/projects", "/estimates", "/issued-invoices", "/mail-sorter", "/received-invoices", "/imports", "/payments", "/expenses", "/reports", "/partners"],
  CHIEF_DESIGNER: ["/documents", "/projects", "/received-invoices", "/imports", "/expenses"],
  PROJECT_MANAGER: ["/documents", "/projects", "/estimates", "/issued-invoices", "/expenses"],
  MAIL_EDITOR: ["/documents", "/mail-sorter", "/expenses"],
  BILLING_EDITOR: ["/estimates", "/issued-invoices", "/partners"],
  DESIGNER: ["/expenses"], GUEST: [],
};
const originalLanding: Record<UserRole, string> = { ADMIN: "/dashboard", ACCOUNTING: "/dashboard", CHIEF_DESIGNER: "/projects", PROJECT_MANAGER: "/projects", MAIL_EDITOR: "/mail-sorter", BILLING_EDITOR: "/issued-invoices", DESIGNER: "/projects", GUEST: "/guest-invoices" };

for (const role of roles) {
  test(`${role}: no overrides preserve every base permission, menu and landing page`, () => {
    assert.deepEqual(sorted(effectivePermissions(role)), sorted(originalPermissions[role]));
    assert.deepEqual(sorted(effectivePermissions(role, {})), sorted(originalPermissions[role]));
    for (const permission of new Set(Object.values(originalPermissions).flat())) assert.equal(can({ role }, permission), canRole(role, permission), permission);
    assert.deepEqual(navigationGroups({ role }).flatMap((group) => group.items.map((item) => item.href)), originalPaths[role]);
    assert.equal(defaultPathForUser({ role }), originalLanding[role]);
    assert.equal(defaultPathForRole(role), originalLanding[role]);
  });

  test(`${role}: each switch removes all covered rights or grants only grant rights`, () => {
    for (const feature of memberFeatures) {
      const base = new Set(originalPermissions[role]);
      const owns = [...feature.grant, ...feature.revokeAlso].some((permission) => base.has(permission));
      assert.equal(roleHasFeature(role, feature.key), owns);
      for (const state of [false, true]) {
        const expected = new Set(base);
        if (role !== "GUEST") {
          if (!state) for (const permission of [...feature.grant, ...feature.revokeAlso]) expected.delete(permission);
          else if (!owns) for (const permission of feature.grant) expected.add(permission);
        }
        const access = { role, featureAccess: { [feature.key]: state } };
        assert.deepEqual(sorted(effectivePermissions(role, access.featureAccess)), sorted(expected), `${feature.key}:${state}`);
        assert.equal(effectiveFeatures(role, access.featureAccess)[feature.key], role === "GUEST" ? owns : state);
        assert.equal(canAccessPath(access, defaultPathForUser(access)), true, feature.key);
      }
    }
  });

  test(`${role}: normalization stores only differences and role-bound rights never change`, () => {
    assert.equal(normalizeFeatureAccess(role, effectiveFeatures(role)), undefined);
    assert.equal(normalizeFeatureAccess(role, {}), undefined);
    for (const state of [false, true]) {
      const normalized = normalizeFeatureAccess(role, allStates(state));
      const expected = role === "GUEST" ? {} : Object.fromEntries(memberFeatures.filter(({ key }) => roleHasFeature(role, key) !== state).map(({ key }) => [key, state]));
      assert.deepEqual(normalized, Object.keys(expected).length ? expected : undefined);
      const permissions = effectivePermissions(role, { ...allStates(state), ...Object.fromEntries(roleBound.map((permission) => [permission, state])) });
      for (const permission of roleBound) assert.equal(permissions.has(permission), originalPermissions[role].includes(permission), permission);
    }
    const access = { role, featureAccess: allStates(false) };
    // Administration and guest creation are intentionally outside the switch catalog.
    assert.equal(defaultPathForUser(access), role === "ADMIN" ? "/users" : role === "GUEST" ? "/guest-invoices" : "/no-access");
  });
}

test("catalog order and coverage are complete, disjoint and exclude all role-bound rights", () => {
  assert.deepEqual(memberFeatures.map(({ key }) => key), ["dashboard", "banking", "documents", "projects", "issuedInvoices", "mailSorter", "receivedInvoices", "imports", "payments", "expenses", "expenseApproval", "reports", "csvExport", "partners"]);
  const covered = memberFeatures.flatMap((feature) => [...feature.grant, ...feature.revokeAlso]);
  assert.equal(new Set(covered).size, covered.length);
  for (const permission of roleBound) assert.ok(!covered.some((entry) => entry === permission));
  for (const permission of new Set(Object.values(originalPermissions).flat())) if (!roleBound.includes(permission)) assert.equal(covered.filter((entry) => entry === permission).length, 1, permission);
});

test("unknown, inherited and non-boolean values cannot grant or revoke permissions", () => {
  const invalid = { dashboard: "true", banking: 1, expenses: null, projects: [], unknown: true, "manage:users": true } as unknown as FeatureAccess;
  for (const role of roles) {
    assert.deepEqual(effectivePermissions(role, invalid), effectivePermissions(role));
    assert.equal(normalizeFeatureAccess(role, invalid), undefined);
    assert.deepEqual(effectivePermissions(role, Object.create({ banking: true, expenses: false })), effectivePermissions(role));
  }
});

test("derived rights and a server mutation refuse disabled features", () => {
  const access = { ...admin, featureAccess: { issuedInvoices: false, projects: false } };
  for (const permission of ["manage:issuedInvoices", "view:estimates", "manage:estimates", "manage:invoiceProjects"]) {
    assert.equal(can(access, permission), false);
    assert.throws(() => assertCan(access, permission), /権限/);
  }
  const data = fixture(), before = structuredClone(data);
  assert.throws(() => applyIssuedInvoiceEdits(data, access, "JAPAN", []), /権限/);
  assert.deepEqual(data, before);
  assert.equal(can({ role: "BILLING_EDITOR", featureAccess: { issuedInvoices: false } }, "manage:invoiceProjects"), false);
  assert.equal(can({ role: "MAIL_EDITOR", featureAccess: { issuedInvoices: true } }, "manage:estimates"), true);
  assert.equal(can(null, "view:dashboard"), false);
});

test("every navigation surface and requested redirect respects switches", () => {
  const access = { role: "ADMIN" as const, featureAccess: { banking: false, issuedInvoices: false, mailSorter: false, projects: false } };
  const params = new URLSearchParams("company=JAPAN");
  const paths = [
    ...sidebarNavigation("/banking", params, access).flatMap((group) => group.items.map((item) => item.href)),
    ...commandNavigation("/banking", params, access).map((item) => item.href),
    ...Object.values(mobileNavigation(access)).flat().map((item) => item.href),
    ...workflowNavigation("/projects", params, access).map((item) => item.href),
    ...workflowNavigation("/mail-sorter", params, access).map((item) => item.href),
  ];
  assert.ok(paths.every((path) => !/^\/(banking|issued-invoices|estimates|mail-sorter|projects)(\?|\/|$)/.test(path)));
  for (const path of ["/banking", "/estimates", "/issued-invoices?company=JAPAN", "/projects/one", "/login", "//example.invalid", "/unknown"]) assert.equal(pathForUser(access, path), "/dashboard");
  assert.equal(pathForUser(access, "/expenses/capture?company=JAPAN"), "/expenses/capture?company=JAPAN");
  assert.equal(pathForUser({ role: "DESIGNER", featureAccess: { projects: false } }, "/projects"), "/expenses");
  assert.equal(canAccessPath({ role: "DESIGNER" }, "/projects/one"), false);
});

function tokenFixture() {
  const data = fixture();
  const owner: User = { ...admin, name: "Example member", email: "member@example.invalid", passwordHash: "unused-test-hash", createdAt: timestamp, updatedAt: timestamp };
  data.users.push(owner);
  const secret = generateAgentTokenSecret();
  issueAgentToken(data, owner, { name: "Example token", scopes: agentScopeList, expiresInDays: 1, hash: secret.hash, prefix: secret.prefix });
  const auth = () => {
    const verified = verifyAgentToken(data, `Bearer ${secret.plain}`);
    assert.ok(verified.ok);
    return verified.auth;
  };
  return { data, owner, auth };
}

test("owner switches immediately limit existing tokens and token issuance", () => {
  const { data, owner, auth } = tokenFixture();
  assert.equal(agentCan(auth(), "bank:read"), true);
  owner.featureAccess = { banking: false };
  assert.equal(agentCan(auth(), "bank:read"), false);
  assert.equal(agentCan(auth(), "bank:write"), false);
  assert.throws(() => listAgentResource(data, auth(), "bank-transactions", {}), /スコープ/);
  const result = runAgentOperations(data, auth(), agentBatchSchema.parse({ operations: [{ op: "bank.classify", target: { id: "missing" } }] }));
  assert.equal(result.failed, 1);
  const secret = generateAgentTokenSecret();
  assert.throws(() => issueAgentToken(data, owner, { name: "Denied token", scopes: ["bank:read"], expiresInDays: 1, hash: secret.hash, prefix: secret.prefix }), /スコープ/);
  owner.featureAccess = { banking: true };
  assert.equal(agentCan({ ...auth(), token: { ...auth().token, scopes: [] } }, "bank:read"), false);
});

test("broad agent read scopes cannot bypass disabled document, payment, partner or project features", () => {
  const { data, owner, auth } = tokenFixture();
  for (const [key, resource] of [["issuedInvoices", "issued-invoices"], ["receivedInvoices", "received-invoices"], ["mailSorter", "mail-documents"], ["payments", "payments"], ["partners", "vendors"], ["projects", "projects"]] as const) {
    owner.featureAccess = { [key]: false };
    assert.throws(() => listAgentResource(data, auth(), resource, {}), /権限/);
  }
});

test("saved agent responses require current scope and operation permissions too", () => {
  const { data, owner, auth } = tokenFixture();
  const request = (op: "bank.classify" | "project.create" | "payment.record") => agentBatchSchema.parse({ operations: [{ op, payload: op === "payment.record" ? { kind: "received", invoiceId: "received-1", amount: 1, paymentDate: "2026-09-15" } : {} }] }).operations[0];
  for (const [key, op] of [["banking", "bank.classify"], ["projects", "project.create"], ["expenseApproval", "payment.record"]] as const) {
    owner.featureAccess = { [key]: false };
    const before = structuredClone(data);
    assert.throws(() => assertAgentOperationAccess(data, auth(), request(op)), /権限|スコープ/);
    assert.deepEqual(data, before);
  }
  data.payments.push({ id: "canceled", type: "EXPENSE", receivedInvoiceId: "received-1", amount: 1, paymentDate: "2026-09-15", method: "Example", createdById: owner.id, createdAt: timestamp, updatedAt: timestamp, deletedAt: timestamp });
  const cancel = agentBatchSchema.parse({ operations: [{ op: "payment.cancel", target: { id: "canceled" } }] }).operations[0];
  assert.throws(() => assertAgentOperationAccess(data, auth(), cancel), /権限/);
  owner.featureAccess = {};
  assert.doesNotThrow(() => assertAgentOperationAccess(data, auth(), cancel));
});

test("file access follows switches, including designer upload and mail direct-upload exceptions", () => {
  const data = fixture();
  assert.equal(canViewDocumentFile(data, admin, "issued.pdf"), true);
  assert.equal(canViewDocumentFile(data, { ...admin, featureAccess: { issuedInvoices: false } }, "issued.pdf"), false);
  assert.equal(canViewDocumentFile(data, { ...admin, featureAccess: { projects: false } }, "contract.pdf"), false);
  const designer = { id: "manager", role: "DESIGNER" as const };
  assert.equal(canViewDocumentFile(data, designer, "received.pdf"), true);
  assert.equal(canViewDocumentFile(data, { ...designer, featureAccess: { receivedInvoices: false } }, "received.pdf"), false);
  data.mailDocuments = []; data.attachments = [];
  const mail = { id: "mail", role: "MAIL_EDITOR" as const };
  assert.equal(canViewDocumentFile(data, mail, "received.pdf"), true);
  assert.equal(canViewDocumentFile(data, { ...mail, featureAccess: { mailSorter: false } }, "received.pdf"), false);
  assert.equal(canViewDocumentFile(data, admin, "../issued.pdf"), false);
});

test("enabled features preserve assigned-project, billing and guest data scopes", () => {
  const data = fixture();
  const designer = { id: "manager", role: "DESIGNER" as const, featureAccess: { issuedInvoices: true } };
  assert.deepEqual(visibleProjects(data, designer).map((row) => row.id), ["japan"]);
  assert.deepEqual(documentRows(data, designer, "JAPAN").map((row) => row.sourceId), ["issued-1"]);
  assert.deepEqual(documentRows(data, designer, "CHINA"), []);
  assert.deepEqual(visibleProjects(data, { id: "billing", role: "BILLING_EDITOR", featureAccess: { projects: true } }).map((row) => row.id), ["japan", "other"]);
  assert.deepEqual(documentRows(data, { id: "guest", role: "GUEST", featureAccess: allStates(true) }, "JAPAN"), []);
});

test("all-document exports omit bank rows when banking is off", () => {
  const data = fixture();
  // Invalid records would be read if the banking branch ran; a disabled branch must not touch them.
  Object.defineProperty(data, "bankTransactions", { get() { throw new Error("disabled banking was read"); } });
  const result = sectionExport(data, { ...admin, featureAccess: { banking: false } }, { company: "JAPAN", scope: "all", start: "2026-01-01", end: "2026-12-31", basis: "document", undated: "1" });
  assert.deepEqual(result.bank, []);
  assert.throws(() => sectionExport(fixture(), { ...admin, featureAccess: { csvExport: false } }, result.query), /権限/);
});
