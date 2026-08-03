import { describe, expect, test } from "bun:test";
import { normalizeCachePath } from "./cache-path.js";

describe("normalizeCachePath", () => {
  test("preserves legal POSIX backslashes", () => {
    expect(normalizeCachePath("directory\\file.ts", "/")).toBe(
      "directory\\file.ts",
    );
  });

  test("normalizes Windows separators to Git-style slashes", () => {
    expect(normalizeCachePath("directory\\nested\\file.ts", "\\")).toBe(
      "directory/nested/file.ts",
    );
  });
});
