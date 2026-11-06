import assert from "node:assert/strict";
import test from "node:test";
import { appNavigation, commandNavigation, mobileNavigation, navHref, navigationActive, navigationCompany, navigationGroups, sidebarNavigation, workflowNavigation } from "../src/lib/app-navigation";
import { canRole } from "../src/lib/rbac";
import { navigationIconName, navigationIconNames } from "../src/lib/navigation-icons";
import { navigationIntentEvent, requestAppNavigation, type NavigationIntent } from "../src/lib/navigation-intent";
import { matchesMailSearch } from "../src/lib/mail-search";
import type { UserRole } from "../src/lib/types";

test("navigation retains every existing destination exactly once and removes empty role groups", () => {
  const paths = appNavigation.flatMap((group) => group.items.map((item) => item.href));
  assert.equal(paths.length, 14); assert.equal(new Set(paths).size, 14);
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
  const tabs = workflowNavigation("/banking", new URLSearchParams("company=JAPAN&account=a%2Fb&month=2026-09&transaction=secret&category=c&page=5&q=private"), "ACCOUNTING");
  assert.equal(tabs.filter((tab) => tab.active).length, 1);
  for (const tab of tabs) {
    const url = new URL(tab.href, "https://test.invalid");
    assert.equal(url.searchParams.get("company"), "JAPAN");
    for (const key of ["transaction", "category", "page", "q"]) assert.equal(url.searchParams.has(key), false);
    if (["/banking/reconcile", "/banking/accounts"].includes(url.pathname)) assert.equal(url.searchParams.has("account"), false);
    else assert.equal(url.searchParams.get("account"), "a/b");
    if (url.pathname === "/banking/accounts") assert.equal(url.searchParams.has("month"), false);
  }
  assert.ok(tabs.find((tab) => tab.label === "AI・確認事項")?.href.includes("checkMonth=2026-09"));
});

test("account overview always opens latest data instead of inheriting an old month or fiscal period", () => {
  for (const path of ["/banking", "/banking/reconcile", "/banking/accounts"]) {
    const tabs = workflowNavigation(path, new URLSearchParams("company=JAPAN&month=2026-06&checkMonth=2026-05&fiscalYear=2026"), "ADMIN");
    assert.equal(tabs.find((tab) => tab.label === "口座一覧")!.href, "/banking/accounts?company=JAPAN");
  }
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
  assert.equal(mail[1].href, "/received-invoices?company=JAPAN");
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

test("every navigation destination names an icon for the phone menu", () => {
  for (const item of appNavigation.flatMap((group) => group.items)) assert.ok(navigationIconNames[item.href], item.href);
});

const roles: UserRole[] = ["ADMIN", "ACCOUNTING", "CHIEF_DESIGNER", "PROJECT_MANAGER", "MAIL_EDITOR", "BILLING_EDITOR", "DESIGNER", "GUEST"];

test("sidebar keeps the existing groups, order, permissions and active parent destinations for every role", () => {
  for (const role of roles) {
    for (const pathname of ["/dashboard", "/projects/123", "/received-invoices", "/users"]) {
      const params = new URLSearchParams("company=JAPAN");
      const groups = sidebarNavigation(pathname, params, role);
      assert.deepEqual(groups, navigationGroups(role).map((group) => ({
        label: group.label,
        items: group.items.map((item) => ({
          label: item.label,
          href: navHref(item.href, "JAPAN"),
          icon: navigationIconName(item.href),
          active: navigationActive(pathname, item.href),
        })),
      })), `${role}: ${pathname}`);
    }
  }
  assert.equal(appNavigation[0].items.find((item) => item.href === "/banking")?.label, "口座・カード");
  assert.equal(mobileNavigation("ADMIN").primary.find((item) => item.href === "/banking")?.label, "口座・カード");
});

test("sidebar bank children reuse workflow permissions, context and active states without changing query params", () => {
  for (const role of roles) {
    for (const pathname of ["/banking", "/banking/accounts", "/banking/reconcile", "/banking/insights", "/banking/forecast", "/banking/payroll", "/banking/obligations", "/banking/integrity"]) {
      for (const query of [
        "company=JAPAN&account=a%2Fb&month=2026-09&transaction=secret&category=c&page=5&q=private",
        "company=CHINA&account=synthetic&checkMonth=2026-08&view=checks",
        "company=JAPAN&month=2026-13&view=invoices",
      ]) {
        const params = new URLSearchParams(query);
        const before = params.toString();
        const bank = sidebarNavigation(pathname, params, role).flatMap((group) => group.items).find((item) => item.label === "口座・カード");
        const tabs = workflowNavigation(pathname, params, role);
        assert.equal(params.toString(), before);
        assert.deepEqual(bank?.children ?? [], tabs.map((tab) => ({ ...tab, icon: navigationIconName(tab.href) })));
        assert.equal(bank?.children?.length ?? 0, canRole(role, "view:banking") ? canRole(role, "manage:banking") ? 9 : 7 : 0);
        if (!canRole(role, "manage:banking")) assert.ok(!bank?.children?.some((child) => child.href.startsWith("/banking/reconcile")));
        if (bank) {
          assert.equal(bank.href, "/banking/accounts?company=JAPAN");
          assert.ok(bank.active);
          assert.equal(bank.children?.filter((child) => child.active).length, 1);
        }
      }
    }
  }
});

test("bank children only expand on banking routes", () => {
  for (const pathname of ["/dashboard", "/banking-extra", "/projects/banking", "/mail-sorter"]) {
    for (const role of roles) assert.ok(sidebarNavigation(pathname, new URLSearchParams(), role).every((group) => group.items.every((item) => !item.children)));
  }
});

test("sidebar company queries retain current Japan-only access and mail scoping", () => {
  for (const role of roles) {
    for (const value of ["JAPAN", "CHINA", "invalid"]) {
      const groups = sidebarNavigation("/banking/reconcile", new URLSearchParams({ company: value, view: "checks" }), role);
      for (const item of groups.flatMap((group) => group.items).flatMap((item) => [item, ...(item.children ?? [])])) {
        const url = new URL(item.href, "https://test.invalid");
        assert.equal(url.searchParams.get("company"), url.pathname === "/mail-sorter" ? "JAPAN" : navigationCompany(role, value));
      }
    }
  }
  assert.equal(navHref("/projects", "CHINA"), "/projects?company=CHINA");
  assert.equal(navHref("/banking", "CHINA"), "/banking/accounts?company=CHINA");
  assert.equal(navHref("/mail-sorter", "CHINA"), "/mail-sorter?company=JAPAN");
});

test("palette exposes all permitted bank screens from any route, with no duplicate destinations", () => {
  const params = new URLSearchParams("company=CHINA&account=synthetic&month=2026-09&view=checks");
  for (const role of roles) {
    const screens = commandNavigation("/dashboard", params, role);
    const main = navigationGroups(role).flatMap((group) => group.items).filter((item) => item.href !== "/banking");
    const bank = workflowNavigation("/banking", params, role);
    assert.equal(screens.length, main.length + bank.length);
    assert.equal(new Set(screens.map((screen) => screen.href)).size, screens.length);
    assert.deepEqual(screens.filter((screen) => screen.group === "口座・カード").map(({ label, href }) => ({ label, href })), bank.map(({ label, href }) => ({ label, href })));
    assert.deepEqual(screens.filter((screen) => screen.group !== "口座・カード").map((screen) => screen.href), main.map((item) => navHref(item.href, navigationCompany(role, "CHINA"))));
    assert.ok(screens.every((screen) => screen.group && screen.icon && screen.href.startsWith("/")));
  }
  assert.equal(commandNavigation("/dashboard", params, "ADMIN").length, 22);
  const checks = commandNavigation("/banking/reconcile", params, "ADMIN").find((screen) => screen.label === "AI・確認事項");
  assert.ok(checks);
  assert.match(checks!.href, /checkMonth=2026-09/);
});

test("all sidebar and palette destinations include icon names, including the distinct AI checks route", () => {
  for (const role of roles) {
    const params = new URLSearchParams("company=JAPAN&view=checks");
    const items = sidebarNavigation("/banking/reconcile", params, role).flatMap((group) => group.items).flatMap((item) => [item, ...(item.children ?? [])]);
    for (const item of [...items, ...commandNavigation("/dashboard", params, role)]) {
      assert.ok(item.icon, item.href);
      assert.equal(item.icon, navigationIconName(item.label === "口座・カード" ? "/banking" : item.href));
    }
  }
  assert.notEqual(navigationIconName("/banking/reconcile?company=JAPAN&view=checks"), navigationIconName("/banking/reconcile?company=JAPAN"));
});

test("programmatic navigation lets unsaved editors veto the exact destination", () => {
  const target = new EventTarget();
  const href = "/banking/reconcile?view=checks&company=JAPAN&checkMonth=2026-09";
  assert.equal(requestAppNavigation(href, target), true);
  const guard = (event: Event) => {
    assert.equal((event as NavigationIntent).detail.href, href);
    event.preventDefault();
  };
  target.addEventListener(navigationIntentEvent, guard);
  assert.equal(requestAppNavigation(href, target), false);
  target.removeEventListener(navigationIntentEvent, guard);
  assert.equal(requestAppNavigation(href, target), true);
});
