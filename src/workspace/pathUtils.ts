function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^file:\/\//, "");
}

function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || path.startsWith("/");
}

export function relativeWorkspacePath(path: string, rootPath: string | null): string | null {
  if (!path) return null;

  const normalizedPath = normalizePath(path);
  if (!isAbsolutePath(normalizedPath)) return normalizedPath.replace(/^\.\//, "");
  if (!rootPath) return null;

  const normalizedRoot = normalizePath(rootPath).replace(/\/$/, "");
  const pathLower = normalizedPath.toLowerCase();
  const rootLower = normalizedRoot.toLowerCase();
  if (!pathLower.startsWith(`${rootLower}/`)) return null;

  return normalizedPath.slice(normalizedRoot.length + 1);
}

export function absoluteWorkspacePath(path: string, rootPath: string | null): string | null {
  if (!path) return null;

  const normalizedPath = path.replace(/\\/g, "/");
  if (isAbsolutePath(normalizedPath)) return path;
  if (!rootPath) return null;

  return `${rootPath.replace(/[\\/]$/, "")}\\${normalizedPath.replace(/\//g, "\\")}`;
}
