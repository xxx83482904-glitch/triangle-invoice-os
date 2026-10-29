import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { companyFromParam, companyOptions } from "../src/lib/company";
import { canAccessCompany, companyForUser } from "../src/lib/rbac";
import { visibleProjects } from "../src/lib/documents";
import { assertJapanData } from "../src/lib/japan-storage";
import { proxy } from "../src/proxy";
import type { AppData } from "../src/lib/types";

test("Japan navigation defaults and permissions never expose China", () => {
  assert.deepEqual(companyOptions.map((row) => row.value), ["JAPAN"]);
  assert.equal(companyFromParam(), "JAPAN");
  assert.equal(companyFromParam("CHINA"), "CHINA");
  for (const role of ["ADMIN", "ACCOUNTING", "BILLING_EDITOR", "MAIL_EDITOR"] as const) {
    assert.equal(canAccessCompany({ role }, "CHINA"), false);
    assert.equal(companyForUser({ role }, "CHINA"), "JAPAN");
  }
  const data = { projects: [{ id: "jp", company: "JAPAN" }, { id: "cn", company: "CHINA" }] } as AppData;
  assert.deepEqual(visibleProjects(data, { id: "admin", role: "ADMIN" }).map((row) => row.id), ["jp"]);
});
test("old China pages redirect and China API or writes are rejected", () => {
  const response = proxy(new NextRequest("http://localhost/banking?company=CHINA&account=old&month=2026-10"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/banking?company=JAPAN&month=2026-10");
  for (const url of ["http://localhost/api/export/projects?company=CHINA", "http://localhost/api/export/projects?company=JAPAN&company=CHINA"]) assert.equal(proxy(new NextRequest(url)).status, 403);
  assert.equal(proxy(new NextRequest("http://localhost/projects?company=CHINA", { method: "POST" })).status, 403);
  assert.equal(proxy(new NextRequest("http://localhost/mail-sorter?company=JAPAN")).status, 200);
});
test("storage prevents Chinese data or undo snapshots from being reintroduced", () => {
  const data = { projects: [{ id: "jp", company: "JAPAN" }], issuedInvoices: [], receivedInvoices: [], estimates: [] } as unknown as AppData;
  assertJapanData(data);
  data.projects.push({ id: "cn", company: "CHINA" } as never);
  assert.throws(() => assertJapanData(data), /分離・移行/);
  data.projects.pop(); data.receivedInvoices.push({ projectId: "cn" } as never);
  assert.throws(() => assertJapanData(data), /関連しない書類/);
});
