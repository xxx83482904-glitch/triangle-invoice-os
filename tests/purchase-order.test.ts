import assert from "node:assert/strict";
import test from "node:test";
import { detectImportDocument, importFillKeysByKind, missingImportDocuments, suggestsCustomsCategory } from "../src/lib/import-shipments";
import { applyImportShipmentMutation, importShipmentViews } from "../src/lib/import-shipment-views";
import { canViewImportFile } from "../src/lib/import-shipment-files";
import { importShipmentsFixture } from "./import-shipments-fixture";
import { admin } from "./document-fixture";

test("Japanese and English purchase orders are separate from invoices and optional in the closing checklist", () => {
  for (const heading of ["発注書", "注文書", "PURCHASE ORDER"]) {
    assert.equal(detectImportDocument(`${heading}\nFOB Shanghai`)?.kind, "PURCHASE_ORDER");
    assert.equal(suggestsCustomsCategory(heading), true);
  }
  assert.deepEqual(importFillKeysByKind.PURCHASE_ORDER, []);
  assert.notEqual(detectImportDocument("Commercial Invoice\n発注書番号 PO-123")?.kind, "PURCHASE_ORDER");
  assert.equal(missingImportDocuments([]).includes("PURCHASE_ORDER"), false);
});

test("purchase order can be assigned, previewed and detached with ordinary shipment access checks", () => {
  const data = importShipmentsFixture();
  const mail = data.mailDocuments[0];
  const shipment = data.importShipments![0];
  applyImportShipmentMutation(data, admin, "JAPAN", { action: "assign", shipmentId: shipment.id, source: "mail", documentId: mail.id, kind: "PURCHASE_ORDER" });
  assert.equal(importShipmentViews(data, "JAPAN").find((view) => view.id === shipment.id)?.documents.find((row) => row.id === mail.id)?.kind, "PURCHASE_ORDER");
  const name = decodeURIComponent(mail.fileUrl.split("/").at(-1)!);
  assert.equal(canViewImportFile(data, admin, name), true);
  const before = structuredClone(data);
  assert.throws(() => applyImportShipmentMutation(data, admin, "CHINA", { action: "assign", shipmentId: shipment.id, source: "mail", documentId: mail.id, kind: "PURCHASE_ORDER" }));
  assert.deepEqual(data, before);
  applyImportShipmentMutation(data, admin, "JAPAN", { action: "assign", shipmentId: null, source: "mail", documentId: mail.id, kind: "PURCHASE_ORDER" });
  assert.equal(mail.importShipmentId, undefined);
  assert.ok(mail.fileUrl);
});
