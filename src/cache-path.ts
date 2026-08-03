import { sep } from "node:path";

export function normalizeCachePath(
  path: string,
  pathSeparator: string = sep,
): string {
  return pathSeparator === "\\" ? path.replaceAll("\\", "/") : path;
}
