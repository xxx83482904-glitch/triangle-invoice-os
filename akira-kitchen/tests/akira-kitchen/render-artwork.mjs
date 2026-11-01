// Rasterize app SVG artwork for visual inspection; these are not browser screenshots.
import { createRequire } from "node:module";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { JSDOM } from "jsdom";
import { bundle, project } from "./bundle.mjs";
import { newRecipe } from "../../src/app/akira-kitchen/cooking-model.ts";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const sharp = require("sharp");
GlobalFonts.registerFromPath("C:/Windows/Fonts/arial.ttf", "QA Arial");
const { CookingGesture } = await bundle(
  "controls",
  "src/app/akira-kitchen/cooking-controls.tsx",
);
const { dishSVG, sampleRecipe } = await bundle(
  "visual-art",
  "src/app/akira-kitchen/cooking-art.tsx",
);
const { embedIllustrations } = await bundle(
  "visual-assets",
  "src/app/akira-kitchen/illustration-assets.ts",
);
const embed = (svg) =>
  embedIllustrations(
    svg,
    async (url) =>
      "data:image/png;base64," +
      (await readFile(project + "public" + url)).toString("base64"),
  );
const cases = [
  ["rice", 0],
  ["rice", 1.5],
  ["rice", 2.5],
  ["rice", 3],
  ["egg", 0.5],
  ["egg", 1.5],
  ["egg", 3.5],
  ["egg", 5],
  ["chicken", 0.5],
  ["chicken", 1.5],
  ["chicken", 3.5],
  ["chicken", 4],
  ["batter", 0.5],
  ["batter", 2.5],
  ["batter", 4.5],
  ["bake", 3],
];
const canvas = createCanvas(1200, 1000),
  ctx = canvas.getContext("2d");
ctx.fillStyle = "#fff8e7";
ctx.fillRect(0, 0, 1200, 1000);
for (let i = 0; i < cases.length; i++) {
  const [process, value] = cases[i],
    recipe = newRecipe("bento");
  recipe.progress[process] = value;
  const html = renderToStaticMarkup(
    React.createElement(CookingGesture, {
      process,
      recipe,
      onProgress: () => {},
      play: () => {},
    }),
  );
  const dom = new JSDOM(html);
  const svg = dom.window.document.querySelector("svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", "520");
  svg.setAttribute("height", "400");
  const pic = await loadImage(
    await sharp(Buffer.from(await embed(svg.outerHTML)))
      .png()
      .toBuffer(),
  );
  const x = (i % 4) * 300,
    y = Math.floor(i / 4) * 250;
  ctx.drawImage(pic, x, y, 300, 225);
  ctx.font = "18px QA Arial";
  ctx.fillStyle = "#0d2867";
  ctx.fillText(`${process} ${value}`, x + 15, y + 240);
  dom.window.close();
}
const folder = project + "docs/akira-kitchen/qa/";
await mkdir(folder, { recursive: true });
await writeFile(folder + "v2-process-art.png", canvas.toBuffer("image/png"));
for (const mode of ["bento", "cake"]) {
  const svg = await embed(dishSVG(sampleRecipe(mode, newRecipe(mode))));
  await writeFile(folder + "v2-" + mode + ".svg", svg);
  await sharp(Buffer.from(svg))
    .png()
    .toFile(folder + "v2-" + mode + ".png");
}
console.log("Saved SVG artwork QA renders (not page screenshots).");
