import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { bundle, project } from "./bundle.mjs";
import { newRecipe } from "../../src/app/akira-kitchen/cooking-model.ts";
const sharp = createRequire(new URL("../../package.json", import.meta.url))(
  "sharp",
);
const { dishSVG, sampleRecipe } = await bundle(
  "image-test-art",
  "src/app/akira-kitchen/cooking-art.tsx",
);
const { embedIllustrations } = await bundle(
  "image-test-assets",
  "src/app/akira-kitchen/illustration-assets.ts",
);
const localImage = async (url) =>
  "data:image/png;base64," +
  (await sharp(await readFile(project + "public" + url)).png().toBuffer()).toString("base64");

test("saved illustrations are embedded once per atlas with no external image dependency", async () => {
  const recipe = sampleRecipe("bento", newRecipe("bento"));
  recipe.items = Array.from({ length: 30 }, (_, i) => ({
    ...recipe.items[i % 7],
    id: String(i),
  }));
  let reads = 0;
  const svg = await embedIllustrations(dishSVG(recipe), (url) => {
    reads++;
    return localImage(url);
  });
  assert.equal(reads, 8);
  assert.equal((svg.match(/data:image\/png;base64,/g) ?? []).length, 8);
  assert.equal((svg.match(/<use /g) ?? []).length, 41);
  assert.equal(svg.includes('href="/akira-kitchen/'), false);
});

test("actual saved SVG renders generated bento and all three cake flavors without network", async () => {
  const colors = [];
  for (const flavor of ["bento", "vanilla", "chocolate", "strawberry"]) {
    const recipe = sampleRecipe(
      flavor === "bento" ? "bento" : "cake",
      newRecipe(flavor === "bento" ? "bento" : "cake"),
    );
    recipe.cake = flavor;
    const svg = await embedIllustrations(dishSVG(recipe), localImage);
    const { data, info } = await sharp(Buffer.from(svg))
      .resize(320, 200)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let colorful = 0,
      total = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (
        Math.max(data[i], data[i + 1], data[i + 2]) -
          Math.min(data[i], data[i + 1], data[i + 2]) >
        70
      )
        colorful++;
      total += data[i] + data[i + 1] + data[i + 2];
    }
    assert.ok(
      colorful > 6400,
      flavor + " must contain visible food, not a blank album picture",
    );
    colors.push(total);
  }
  assert.equal(
    new Set(colors).size,
    4,
    "flavor changes must visibly change the saved image",
  );
});

test("missing image or invalid data aborts export so the UI can retry instead of saving a blank work", async () => {
  const svg = dishSVG(sampleRecipe("bento", newRecipe("bento")));
  await assert.rejects(
    embedIllustrations(svg, async () => {
      throw new Error("offline asset missing");
    }),
  );
  await assert.rejects(
    embedIllustrations(svg, async () => "https://example.com/image.png"),
  );
});
