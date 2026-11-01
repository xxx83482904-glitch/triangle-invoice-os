// Routes/public URLs already include /akira-kitchen. Namespace only the runtime
// chunks, which are copied into the same static directory after export.
export default {
  output: "export",
  assetPrefix: "/akira-kitchen",
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: { root: process.cwd() },
};
