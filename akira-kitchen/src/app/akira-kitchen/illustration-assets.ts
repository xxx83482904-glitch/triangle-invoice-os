// Generated from the approved UI. PNGs keep their original alpha channel.
// Each crop selects one independent food from a sprite sheet, never a whole UI.
const ROOT = "/akira-kitchen/illustration-";
type Sprite = [string, number, number, number, number];
const SPRITES: Record<string, Sprite> = {
  onigiri: ["bento-foods", 39, 103, 448, 407],
  tamago: ["bento-foods", 543, 110, 455, 404],
  karaage: ["bento-foods", 1041, 86, 476, 438],
  broccoli: ["bento-foods", 29, 527, 487, 453],
  tomato: ["bento-foods", 555, 536, 428, 441],
  carrot: ["bento-foods", 1063, 543, 440, 421],
  strawberry: ["cake-toppings", 93, 65, 405, 428],
  chocolate: ["cake-toppings", 572, 113, 406, 380],
  banana: ["cake-toppings", 1056, 116, 442, 372],
  blueberry: ["cake-toppings", 61, 613, 424, 331],
  cream: ["cake-toppings", 573, 580, 392, 378],
  sprinkles: ["cake-toppings", 1085, 615, 406, 335],
};

export function illustratedFood(food: string): string | null {
  const entry = SPRITES[food];
  if (!entry) return null;
  const [sheet, x, y, width, height] = entry;
  return `<svg width="200" height="200" viewBox="${x} ${y} ${width} ${height}" overflow="hidden"><image href="${ROOT}${sheet}.png" width="1536" height="1024"/></svg>`;
}

export function illustratedBase(mode: string, flavor: string): string {
  if (mode === "bento")
    return `<svg x="20" y="15" width="760" height="470" viewBox="78 186 1381 649" preserveAspectRatio="none"><image href="${ROOT}bento-box.png" width="1536" height="1024"/></svg>`;
  const asset =
    flavor === "chocolate" || flavor === "strawberry"
      ? `cake-${flavor}`
      : "cake-base";
  return `<svg width="800" height="500" viewBox="0 0 1586 992"><image href="${ROOT}${asset}.png" width="1586" height="992"/></svg>`;
}

const imageCache = new Map<string, Promise<string>>();
async function imageData(url: string): Promise<string> {
  let pending = imageCache.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error("えを よみこめませんでした。もういちど ためしてね");
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return "data:image/png;base64," + btoa(binary);
    })();
    imageCache.set(url, pending);
    pending.catch(() => imageCache.delete(url));
  }
  return pending;
}

/** Embed each illustration once so saved SVGs work without network or asset URLs. */
export async function embedIllustrations(
  svg: string,
  readDataUrl: (url: string) => Promise<string> = imageData,
): Promise<string> {
  const tags = [
    ...new Set(
      svg.match(
        /<image href="\/akira-kitchen\/illustration-[a-z-]+\.png"[^>]*\/>/g,
      ) ?? [],
    ),
  ];
  const definitions = await Promise.all(
    tags.map(async (tag, index) => {
      const url = tag.match(/href="([^"]+)"/)![1];
      const data = await readDataUrl(url);
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data))
        throw new Error("イラストを ほぞんできませんでした");
      return tag
        .replace("<image", `<image id="saved-illustration-${index}"`)
        .replace('href="', 'xlink:href="')
        .replace(url, data);
    }),
  );
  tags.forEach((tag, index) => {
    svg = svg.replaceAll(
      tag,
      `<use xlink:href="#saved-illustration-${index}"/>`,
    );
  });
  svg = svg.replace(
    "<svg ",
    '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ',
  );
  return svg.replace(
    /(<svg\b[^>]*>)/,
    "$1<defs>" + definitions.join("") + "</defs>",
  );
}
