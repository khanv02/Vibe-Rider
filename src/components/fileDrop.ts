export const INTERNAL_FILE_DROP_TYPE = "application/x-vibe-rider-path";

export function readDroppedPaths(dataTransfer: DataTransfer): string[] {
  const internalPath = dataTransfer.getData(INTERNAL_FILE_DROP_TYPE).trim();
  if (internalPath) return [internalPath];

  return Array.from(dataTransfer.files)
    .map((file) => (file as File & { path?: string }).path || file.name)
    .filter(Boolean);
}

export function dropPointInCssPixels(position: { x: number; y: number }): { x: number; y: number } {
  const scale = window.devicePixelRatio || 1;
  return { x: position.x / scale, y: position.y / scale };
}

export function quotePowerShellPath(path: string): string {
  return `'${path.replaceAll("'", "''")}'`;
}
