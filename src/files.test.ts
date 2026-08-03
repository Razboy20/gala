import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFiles } from "./files.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function runGit(directory: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: directory,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${stderr.trim()}`);
  }
}

async function createRepository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gala-files-"));
  directories.push(directory);
  await runGit(directory, "init", "--quiet");
  return directory;
}

describe("findFiles", () => {
  test("includes only matching files after exclusions", async () => {
    const directory = await createRepository();
    await mkdir(join(directory, "src"));
    await writeFile(join(directory, "src", "app.ts"), "");
    await writeFile(join(directory, "src", "app.test.ts"), "");
    await writeFile(join(directory, "README.md"), "");
    await runGit(directory, "add", "--", "src", "README.md");

    const files = await findFiles(directory, ["**/*.test.ts"], ["src/"]);

    expect(files).toEqual([join(directory, "src", "app.ts")]);
  });

  test("includes a specific file name", async () => {
    const directory = await createRepository();
    await writeFile(join(directory, "README.md"), "");
    await writeFile(join(directory, "CHANGELOG.md"), "");
    await runGit(directory, "add", "--", "README.md", "CHANGELOG.md");

    const files = await findFiles(directory, [], ["README.md"]);

    expect(files).toEqual([join(directory, "README.md")]);
  });

  test("returns only existing tracked files", async () => {
    const directory = await createRepository();
    await writeFile(join(directory, "tracked.ts"), "");
    await writeFile(join(directory, "deleted.ts"), "");
    await writeFile(join(directory, "untracked.ts"), "");
    await runGit(directory, "add", "--", "tracked.ts", "deleted.ts");
    await rm(join(directory, "deleted.ts"));

    const files = await findFiles(directory);

    expect(files).toEqual([join(directory, "tracked.ts")]);
  });

  test("supports tracked file names containing newlines", async () => {
    const directory = await createRepository();
    const fileName = "line\nbreak.ts";
    await writeFile(join(directory, fileName), "");
    await runGit(directory, "add", "--", fileName);

    const files = await findFiles(directory);

    expect(files).toEqual([join(directory, fileName)]);
  });
});
