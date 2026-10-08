import assert from "node:assert/strict";
import test from "node:test";
import { appNavigation, mobileNavigation, navigationActive, navigationCompany, navigationGroups, workflowNavigation } from "../src/lib/app-navigation";
import { canRole } from "../src/lib/rbac";
import { matchesMailSearch } from "../src/lib/mail-search";
import type { UserRole } from "../src/lib/types";

test("navigation retains every existing destination exactly once and removes empty role groups", () => {
  const paths = appNavigation.flatMap((group) => group.items.map((item) => item.href));
  assert.equal(paths.length, 12); assert.equal(new Set(paths).size, 12);
  for (const role of ["ADMIN", "ACCOUNTING", "CHIEF_DESIGNER", "PROJECT_MANAGER", "MAIL_EDITOR", "BILLING_EDITOR", "DESIGNER", "GUEST"] as UserRole[]) {
    const groups = navigationGroups(role), { primary, more } = mobileNavigation(role);
    assert.ok(groups.every((group) => group.items.length && group.items.every((item) => canRole(role, item.permission))));
    assert.deepEqual([...primary, ...more].map((item) => item.href).sort(), groups.flatMap((group) => group.items.map((item) => item.href)).sort());
    assert.ok(primary.length <= 4);
  }
});

test("limited roles do not gain bank, aggregate or cross-company destinations", () => {
  assert.deepEqual(navigationGroups("BILLING_EDITOR").flatMap((group) => group.items.map((item) => item.href)), ["/estimates", "/issued-invoices", "/partners"]);
  assert.deepEqual(mobileNavigation("MAIL_EDITOR").primary.map((item) => item.href), ["/mail-sorter", "/documents"]);
  for (const role of ["BILLING_EDITOR", "MAIL_EDITOR"] as const) {
    assert.equal(navigationCompany(role, "CHINA"), "JAPAN");
    assert.deepEqual(workflowNavigation("/banking", new URLSearchParams("company=CHINA"), role), []);
  }
  assert.ok(mobileNavigation("ACCOUNTING").primary.some((item) => item.href === "/banking"));
});

test("navigation matches nested routes but not similarly named paths", () => {
  assert.ok(navigationActive("/projects/123", "/projects"));
  assert.ok(navigationActive("/banking/reconcile", "/banking"));
  assert.equal(navigationActive("/projects-extra", "/projects"), false);
});

test("workflow tabs preserve bank account/month without carrying stale selection filters", () => {
  const tabs = workflowNavigation("/banking", new URLSearchParams("company=CHINA&account=a%2Fb&month=2026-09&transaction=secret&category=c&page=5&q=private"), "ACCOUNTING");
  assert.equal(tabs.filter((tab) => tab.active).length, 1);
  for (const tab of tabs) {
    const url = new URL(tab.href, "https://test.invalid");
    assert.equal(url.searchParams.get("company"), "CHINA");
    for (const key of ["transaction", "category", "page", "q"]) assert.equal(url.searchParams.has(key), false);
    if (url.pathname === "/banking/reconcile") assert.equal(url.searchParams.has("account"), false);
    else assert.equal(url.searchParams.get("account"), "a/b");
  }
  assert.ok(tabs.find((tab) => tab.label === "AI・確認事項")?.href.includes("checkMonth=2026-09"));
});

test("AI and normal reconciliation tabs have distinct active states", () => {
  for (const view of ["checks", "invoices", "banks", ""]) {
    const tabs = workflowNavigation("/banking/reconcile", new URLSearchParams({ company: "JAPAN", view, checkMonth: "2026-08" }), "ADMIN");
    assert.equal(tabs.filter((tab) => tab.active).length, 1);
    assert.equal(tabs.find((tab) => tab.active)?.label, view === "checks" ? "AI・確認事項" : "銀行・書類照合");
    assert.ok(tabs.find((tab) => tab.label === "明細")?.href.includes("month=2026-08"));
  }
});

test("sales and receiving workflow tabs stay scoped and respect permissions", () => {
  const sales = workflowNavigation("/projects/123", new URLSearchParams("company=JAPAN"), "PROJECT_MANAGER");
  assert.deepEqual(sales.map((tab) => tab.label), ["案件", "見積書", "発行請求書"]);
  assert.equal(sales.find((tab) => tab.active)?.label, "案件");
  const mail = workflowNavigation("/received-invoices", new URLSearchParams("company=CHINA"), "ADMIN");
  assert.equal(mail[0].href, "/mail-sorter?company=JAPAN");
  assert.equal(mail[1].href, "/received-invoices?company=CHINA");
  assert.deepEqual(workflowNavigation("/users", new URLSearchParams(), "ADMIN"), []);
});

test("mail search handles multiple terms, Japanese width, case and missing OCR without mutating data", () => {
  const row = { senderName: "株式会社テスト", fileName: "請求書ＡＢＣ.pdf", ocrPreview: "2026年9月 制作費", extracted: { vendorName: "Test Studio", projectName: "横浜ホテル" } };
  const before = structuredClone(row);
  for (const query of ["", "  ", "テスト", "abc.PDF", "test　横浜", "9月 制作費"]) assert.ok(matchesMailSearch(row, query), query);
  for (const query of ["大阪", "テスト 大阪", "領収書"]) assert.equal(matchesMailSearch(row, query), false, query);
  assert.ok(matchesMailSearch({ fileName: "scan.png", ocrPreview: "" }, "scan"));
  assert.deepEqual(row, before);
});
