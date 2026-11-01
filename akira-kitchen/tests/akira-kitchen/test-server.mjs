import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
export async function startServer() {
  const root = fileURLToPath(new URL("../../out/", import.meta.url));
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".css": "text/css",
    ".webp": "image/webp",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".mp3": "audio/mpeg",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
  };
  const server = createServer(async (req, res) => {
    try {
      let file = path.resolve(
        root,
        "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
      );
      if (!file.startsWith(path.resolve(root) + path.sep))
        throw new Error("outside");
      if ((await stat(file)).isDirectory())
        file = path.join(file, "index.html");
      let body = await readFile(file);
      const headers = {
        "content-type": types[path.extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
      };
      if (
        /\.(?:html|js|css|json|svg)$/.test(file) &&
        (req.headers["accept-encoding"] ?? "").includes("gzip")
      ) {
        body = gzipSync(body);
        headers["content-encoding"] = "gzip";
      }
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: "http://127.0.0.1:" + server.address().port + "/akira-kitchen/",
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
