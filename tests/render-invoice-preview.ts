import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createIssuedInvoicePdf } from "../src/lib/issued-invoice-pdf";
import { invoicePdfFixture } from "./invoice-pdf-fixture";

async function main() {
  const root = path.join(os.tmpdir(), "triangle-invoice-pdf-preview");
  await mkdir(root, { recursive: true });
  for (const [name, count] of [["invoice-sample", 2], ["invoice-multipage", 30]] as const) {
    const data = invoicePdfFixture(count);
    const pdf = await createIssuedInvoicePdf(data.issuedInvoices[0], data);
    await writeFile(path.join(root, name + ".pdf"), pdf);
    execFileSync("pdftoppm", ["-scale-to", "1248", "-png", path.join(root, name + ".pdf"), path.join(root, name)]);
    console.log(JSON.stringify({ name, root }));
  }
}
void main();
