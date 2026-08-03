import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFiles } from "./files.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => Bun.$`rm -rf ${directory}`),
  );
});

describe("findFiles", () => {
  test("includes only matching files after exclusions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gala-files-"));
    directories.push(directory);
    await mkdir(join(directory, "src"));
    await writeFile(join(directory, "src", "app.ts"), "");
    await writeFile(join(directory, "src", "app.test.ts"), "");
    await writeFile(join(directory, "README.md"), "");

    const files = await findFiles(directory, ["**/*.test.ts"], ["src/"]);

    expect(files).toEqual([join(directory, "src", "app.ts")]);
  });

  test("includes a specific file name", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gala-files-"));
    directories.push(directory);
    await writeFile(join(directory, "README.md"), "");
    await writeFile(join(directory, "CHANGELOG.md"), "");

    const files = await findFiles(directory, [], ["README.md"]);

    expect(files).toEqual([join(directory, "README.md")]);
  });
});
