import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { assertCan } from "@/lib/rbac";
import { mutateData, newId } from "@/lib/store";
import type { AppData, SelectOptionGroup } from "@/lib/types";

const now = () => new Date().toISOString();

function nextSortOrder<T extends { company?: string | null; deletedAt?: string | null; sortOrder?: number }>(
  rows: T[],
  company: CompanyScope,
) {
  return (
    Math.max(
      0,
      ...rows
        .filter((row) => !row.deletedAt && companyFromParam(row.company) === company)
        .map((row) => row.sortOrder ?? 0),
    ) + 1
  );
}

function optionSortOrder(data: AppData, group: SelectOptionGroup, company: CompanyScope) {
  return (
    Math.max(
      0,
      ...data.selectOptions
        .filter((option) => !option.deletedAt && option.group === group && companyFromParam(option.company) === company)
        .map((option) => option.sortOrder),
    ) + 1
  );
}

function optionValue(label: string, group: SelectOptionGroup) {
  if (group === "PROJECT_STAGE") return label;
  if (group === "TAX_RATE") return label.replaceAll(/[^0-9.-]+/g, "") || label;
  return label
    .trim()
    .replaceAll(/\s+/g, "_")
    .replaceAll(/[^\p{Letter}\p{Number}_%-]+/gu, "_")
    .toUpperCase();
}

export async function POST(request: Request) {
  const user = await requireUser();
  const body = (await request.json()) as {
    company?: string;
    group?: SelectOptionGroup;
    kind?: "client" | "vendor" | "select-option";
    label?: string;
  };
  const label = String(body.label ?? "").trim();
  if (!label) return NextResponse.json({ error: "名前を入力してください" }, { status: 400 });
  const company = companyFromParam(body.company);
  const timestamp = now();

  if (body.kind === "client") {
    assertCan(user, "manage:clients");
    const client = await mutateData(user.id, "QUICK_CREATE_CLIENT", "Client", label, (data) => {
      const item = {
        id: newId(),
        company,
        companyName: label,
        sortOrder: nextSortOrder(data.clients, company),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      data.clients.push(item);
      return item;
    });
    return NextResponse.json({ label: client.companyName, value: client.id });
  }

  if (body.kind === "vendor") {
    assertCan(user, "manage:vendors");
    const vendor = await mutateData(user.id, "QUICK_CREATE_VENDOR", "Vendor", label, (data) => {
      const item = {
        id: newId(),
        company,
        companyName: label,
        sortOrder: nextSortOrder(data.vendors, company),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      data.vendors.push(item);
      return item;
    });
    return NextResponse.json({ label: vendor.companyName, value: vendor.id });
  }

  if (body.kind === "select-option" && body.group) {
    assertCan(user, "manage:clients");
    const option = await mutateData(user.id, "QUICK_CREATE_SELECT_OPTION", "SelectOption", body.group, (data) => {
      const item = {
        id: newId(),
        company,
        group: body.group as SelectOptionGroup,
        value: optionValue(label, body.group as SelectOptionGroup),
        label,
        sortOrder: optionSortOrder(data, body.group as SelectOptionGroup, company),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      data.selectOptions.push(item);
      return item;
    });
    return NextResponse.json({ label: option.label, value: option.value });
  }

  return NextResponse.json({ error: "作成できない種類です" }, { status: 400 });
}
