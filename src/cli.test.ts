import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directories: string[] = [];
const entrypoint = resolve(import.meta.dir, "..", "gala.ts");

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function command(directory: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(args, {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  return stdout;
}

async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gala-cli-"));
  directories.push(directory);
  await command(directory, "git", "init", "--quiet");
  await command(directory, "git", "config", "user.name", "Gala Test");
  await command(directory, "git", "config", "user.email", "gala@example.com");
  await command(directory, "git", "config", "commit.gpgsign", "false");
  await writeFile(join(directory, "file.ts"), "const value = 1;\n");
  await command(directory, "git", "add", "file.ts");
  await command(directory, "git", "commit", "--quiet", "-m", "initial");
  return directory;
}

describe("cache CLI", () => {
  test("is quiet by default and reports warm user reuse when verbose", async () => {
    const directory = await repository();
    const quiet = await command(directory, "bun", entrypoint, directory);
    expect(quiet).not.toContain("Cache");

    const verbose = await command(
      directory,
      "bun",
      entrypoint,
      directory,
      "Gala Test",
      "--verbose",
    );
    expect(verbose).toContain("Cache status: warm");
    expect(verbose).toContain("Cache invalidation: none");
    expect(verbose).toContain("Cache hits: 1; misses: 0");
    expect(verbose).toContain("Total lines by Gala Test");

    const refreshed = await command(
      directory,
      "bun",
      entrypoint,
      directory,
      "--verbose",
      "--refresh-cache",
    );
    expect(refreshed).toContain("Cache invalidation: refresh requested");
    expect(refreshed).toContain("Cache hits: 0; misses: 1");
  });

  test("bypasses cache for temporary remote clones", async () => {
    const directory = await repository();
    const remote = join(dirname(directory), `${Date.now()}-remote.git`);
    directories.push(remote);
    await command(
      directory,
      "git",
      "clone",
      "--quiet",
      "--bare",
      directory,
      remote,
    );

    const output = await command(
      directory,
      "bun",
      entrypoint,
      remote,
      "--verbose",
    );
    expect(output).toContain(
      "Cache status: bypassed for temporary remote clone",
    );
  });

  test("aggregates Object prototype author names", async () => {
    const directory = await repository();
    await command(directory, "git", "config", "user.name", "constructor");
    await writeFile(
      join(directory, "file.ts"),
      "const value = 1;\nconst two = 2;\n",
    );
    await command(directory, "git", "commit", "--all", "--quiet", "-m", "two");
    await command(directory, "git", "config", "user.name", "__proto__");
    await writeFile(
      join(directory, "file.ts"),
      "const value = 1;\nconst two = 2;\nconst three = 3;\n",
    );
    await command(
      directory,
      "git",
      "commit",
      "--all",
      "--quiet",
      "-m",
      "three",
    );

    const output = await command(directory, "bun", entrypoint, directory);

    expect(output).toContain("constructor");
    expect(output).toContain("__proto__");
    expect(output).toContain("3");
  });
});

function dirname(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}
