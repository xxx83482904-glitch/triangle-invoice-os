import path from "node:path";

export function projectRoot() {
  const cwd = process.cwd();
  return cwd.endsWith(path.join(".next", "standalone")) ? path.resolve(cwd, "..", "..") : cwd;
}

export function runtimeDataDir() {
  return process.env.DATA_DIR ?? path.join(projectRoot(), "data");
}
