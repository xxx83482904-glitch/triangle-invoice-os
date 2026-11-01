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
const { dishBox, boxString, modelPoint, dishPoint, pieceStyle, pieceSize } = await bundle(
  "art-layout", "src/app/akira-kitchen/art-layout.ts",
);

test("legacy piece coordinates round-trip through the cropped presentation without changing recipes", () => {
  for (const mode of ["bento", "cake"]) for (const cake of ["vanilla", "chocolate", "strawberry"]) {
    const recipe = sampleRecipe(mode, newRecipe(mode)); recipe.cake = cake;
    const before = structuredClone(recipe), box = dishBox(recipe);
    for (const point of [...recipe.items, {x:15,y:23}, {x:85,y:66}, {x:50,y:33}]) {
      const style = pieceStyle(recipe,point);
      const recovered = modelPoint(recipe,{x:parseFloat(style.left),y:parseFloat(style.top)});
      assert.ok(Math.abs(recovered.x-point.x)<1e-9 && Math.abs(recovered.y-point.y)<1e-9);
      const displayed = dishPoint(recipe,point);
      assert.ok(Math.abs(box.x+parseFloat(style.left)*box.width/100-displayed.x)<1e-9);
      assert.ok(Math.abs(parseFloat(style.width)*box.width/100-pieceSize(mode))<1e-9);
      assert.ok(Math.abs(parseFloat(style.height)*box.height/100-pieceSize(mode))<1e-9);
    }
    assert.deepEqual(recipe,before);
    assert.ok(dishSVG(recipe).includes(`viewBox="${boxString(box)}"`));
  }
});

test("cake exports keep legacy stroke coordinates inside an explicit elliptical surface clip", () => {
  const recipe = newRecipe("cake");recipe.strokes=[[{x:20,y:20},{x:80,y:44}]];
  const svg = dishSVG(recipe);
  assert.match(svg,/clipPathUnits="userSpaceOnUse"/);
  assert.match(svg,/<ellipse cx="400" cy="155" rx="282" ry="97"/);
  assert.match(svg,/M160 100 L640 220/);
});
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
