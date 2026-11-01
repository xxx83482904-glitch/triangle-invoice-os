import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
export const project = fileURLToPath(new URL("../../", import.meta.url));
export const generated = fileURLToPath(
  new URL("./.generated/", import.meta.url),
);
await mkdir(generated, { recursive: true });
export async function bundle(name, entry) {
  const outfile = path.join(generated, name + ".mjs");
  await build({
    entryPoints: [path.join(project, entry)],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    loader: { ".module.css": "local-css" },
    external: [
      "/akira-kitchen/*",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "lucide-react",
    ],
    define: { "process.env.NODE_ENV": '"test"' },
  });
  return import(new URL("./.generated/" + name + ".mjs", import.meta.url));
}
