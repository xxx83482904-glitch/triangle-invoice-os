import manifest from "./media-manifest.json";
import type { ImgHTMLAttributes } from "react";
import { boxString, croppedMediaBox, mediaGeometry } from "./art-layout";

/** Existing high-resolution art, framed by its painted alpha bounds. */
export function CroppedArt({ name, className }: { name: string; className?: string }) {
  const a = mediaGeometry[name];
  return <svg className={className} viewBox={boxString(croppedMediaBox(name))} aria-hidden="true" data-cropped-art={name}>
    <image href={a.src} width={a.width} height={a.height} />
  </svg>;
}

const assets = manifest as Record<
  string,
  { src: string; srcSet?: string | null }
>;
export const mediaUrl = (name: string) => assets[name]?.src ?? "";
export function ArtImage({
  name,
  sizes = "70vw",
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { name: string }) {
  const asset = assets[name];
  // Static export: use the prebuilt responsive files, with no image server.
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      {...props}
      alt={props.alt ?? ""}
      src={asset?.src}
      srcSet={asset?.srcSet ?? undefined}
      sizes={sizes}
      draggable={false}
    />
  );
}
const decoded = new Map<string, Promise<void>>();
export function preloadMedia(names: string[]) {
  return Promise.all(
    names.map((name) => {
      const url = mediaUrl(name);
      if (!url) return Promise.resolve();
      if (!decoded.has(url))
        decoded.set(
          url,
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              void img
                .decode()
                .catch(() => {})
                .then(resolve);
            };
            img.onerror = () => {
              decoded.delete(url);
              resolve();
            };
            img.src = url;
          }),
        );
      return decoded.get(url)!;
    }),
  );
}
export function screenMedia(screen: number) {
  const common = ["chef-home", "chef-ladle", "kitchen"];
  if (screen === 1)
    return [
      "home-backdrop",
      "home-bento",
      "home-cake",
      "chef-home",
      "title-cloud",
    ];
  if ([2, 7, 8, 9, 10, 16].includes(screen))
    return [
      ...common,
      "bento-box",
      "cake-base",
      "cake-chocolate",
      "cake-strawberry",
      "chef-taste",
      "chef-celebrate",
      "rice-nori",
      "rice-smile",
      "tamago",
      "karaage",
      "broccoli",
      "tomato",
      "carrot",
    ];
  if (screen === 3)
    return [
      ...common,
      "chef-squeeze",
      "rice-tub",
      "rice-round",
      "rice-triangle",
      "rice-smile",
      ...["nori", "ume", "wakame", "salmon", "yukari", "sesame"].map(
        (v) => "rice-" + v,
      ),
    ];
  if (screen === 4 || screen === 12)
    return [
      ...common,
      "ingredient-egg",
      "ingredient-flour",
      "ingredient-milk",
      "tamago",
    ];
  if (screen === 5) return [...common, "karaage"];
  if (screen === 6)
    return [
      ...common,
      "broccoli",
      "carrot",
      "tomato",
      "carrot-star",
      "carrot-heart",
    ];
  return [
    ...common,
    "chef-celebrate",
    "cake-base",
    "cake-chocolate",
    "cake-strawberry",
    "strawberry",
    "chocolate",
    "banana",
    "cream",
    "blueberry",
    "sprinkles",
  ];
}
