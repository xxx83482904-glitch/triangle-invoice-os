import manifest from "./media-manifest.json";
import { cakeAsset, dishBox, mediaGeometry } from "./art-layout";
const assets = manifest as Record<string, { src: string }>;
const img = (name: string, width = 200, height = 200, fullSize = false) =>
  '<image href="' +
  ((fullSize ? mediaGeometry[name]?.src : assets[name]?.src) ?? "") +
  '" width="' +
  width +
  '" height="' +
  height +
  '"' + (fullSize ? ' preserveAspectRatio="none"' : '') + '/>';
export function illustratedFood(food: string): string | null {
  return assets[food] ? img(food) : null;
}
export function illustratedVariant(
  food: string,
  variant: string,
): string | null {
  const name =
    food === "onigiri"
      ? "rice-" + variant
      : food === "carrot"
        ? "carrot-" + variant
        : "";
  return assets[name] ? img(name) : null;
}
export function riceSmile(): string {
  return (
    '<svg x="50" y="85" width="100" height="38" viewBox="0 0 256 88">' +
    img("rice-smile", 256, 88) +
    "</svg>"
  );
}
export function illustratedBase(mode: string, flavor: string): string {
  if (mode === "bento")
    return img("bento-box", 800, dishBox({ mode: "bento", cake: flavor }).height, true);
  return img(cakeAsset({ cake: flavor }), 800, 500, true);
}
const imageCache = new Map<string, Promise<string>>();
async function imageData(url: string): Promise<string> {
  if (!imageCache.has(url)) {
    const pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error("イラストを よみこめませんでした");
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const data =
        "data:image/" +
        (url.endsWith(".webp") ? "webp" : "png") +
        ";base64," +
        btoa(binary);
      // PNG inside saved SVGs keeps the album portable to SVG readers whose
      // embedded-image decoder lacks WebP (runtime delivery remains WebP).
      if (url.endsWith(".webp") && typeof HTMLCanvasElement !== "undefined") {
        const image = new Image();
        image.src = data;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (context) {
          context.drawImage(image, 0, 0);
          return canvas.toDataURL("image/png");
        }
      }
      return data;
    });
    imageCache.set(url, pending);
    pending.catch(() => imageCache.delete(url));
  }
  return imageCache.get(url)!;
}
/** Self-contained snapshots preserve food, flavor, icing and placement. */
export async function embedIllustrations(
  svg: string,
  readDataUrl: (url: string) => Promise<string> = imageData,
): Promise<string> {
  const tags = [
    ...new Set(
      svg.match(
        /<image href="\/akira-kitchen\/(?:media\/[a-z0-9-]+\.webp|illustration-[a-z0-9-]+\.png)"[^>]*\/>/g,
      ) ?? [],
    ),
  ];
  const definitions = await Promise.all(
    tags.map(async (tag, index) => {
      const url = tag.match(/href="([^"]+)"/)![1],
        data = await readDataUrl(url);
      if (!/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/=]+$/.test(data))
        throw new Error("イラストを ほぞんできませんでした");
      return tag
        .replace("<image", '<image id="saved-illustration-' + index + '"')
        .replace('href="', 'xlink:href="')
        .replace(url, data);
    }),
  );
  tags.forEach((tag, index) => {
    svg = svg.replaceAll(
      tag,
      '<use xlink:href="#saved-illustration-' + index + '"/>',
    );
  });
  return svg
    .replace("<svg ", '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ')
    .replace(/(<svg\b[^>]*>)/, "$1<defs>" + definitions.join("") + "</defs>");
}
