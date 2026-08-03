import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openBlameCache } from "./cache.js";
import { createSignature } from "./cache-repository.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function runGit(directory: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${stderr.trim()}`);
  }
  return stdout.trim();
}

async function createRepository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gala-cache-"));
  directories.push(directory);
  await runGit(directory, "init", "--quiet");
  await runGit(directory, "config", "user.name", "Gala Test");
  await runGit(directory, "config", "user.email", "gala@example.com");
  await runGit(directory, "config", "commit.gpgsign", "false");
  await writeFile(join(directory, "a.ts"), "const a = 1;\n");
  await writeFile(join(directory, "b.ts"), "const b = 1;\n");
  await runGit(directory, "add", "--", "a.ts", "b.ts");
  await runGit(directory, "commit", "--quiet", "-m", "initial");
  return directory;
}

async function cacheFile(repository: string): Promise<string> {
  const commonDir = await runGit(
    repository,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  );
  return join(commonDir, "gala-cache", "manifest-v1.json");
}

async function populate(repository: string): Promise<void> {
  const cache = await openBlameCache(repository, 2);
  const a = await cache.lookup("a.ts", join(repository, "a.ts"));
  const b = await cache.lookup("b.ts", join(repository, "b.ts"));
  await cache.record("a.ts", join(repository, "a.ts"), a.digest, { Ada: 1 });
  await cache.record("b.ts", join(repository, "b.ts"), b.digest, { Bob: 1 });
  await cache.save();
}

describe("blame cache", () => {
  test("reuses unchanged files and misses only a dirty file", async () => {
    const repository = await createRepository();
    await populate(repository);

    const warm = await openBlameCache(repository, 2);
    expect(
      (await warm.lookup("a.ts", join(repository, "a.ts"))).histogram,
    ).toEqual({
      Ada: 1,
    });
    await writeFile(join(repository, "b.ts"), "const b = 2;\n");
    expect(
      (await warm.lookup("b.ts", join(repository, "b.ts"))).histogram,
    ).toBeNull();
    expect(warm.stats).toEqual({ hits: 1, misses: 1 });
  });

  test("stores linked worktree data in the common Git directory", async () => {
    const repository = await createRepository();
    const linked = await mkdtemp(join(tmpdir(), "gala-worktree-"));
    directories.push(linked);
    await rm(linked, { recursive: true });
    await runGit(
      repository,
      "worktree",
      "add",
      "--quiet",
      "-b",
      "linked",
      linked,
    );

    const cache = await openBlameCache(linked, 2);

    expect(cache.path).toBe(await cacheFile(repository));
  });

  test("invalidates every path touched during a linear advance", async () => {
    const repository = await createRepository();
    await populate(repository);
    await writeFile(join(repository, "a.ts"), "temporary\n");
    await runGit(repository, "commit", "--all", "--quiet", "-m", "change");
    await writeFile(join(repository, "a.ts"), "const a = 1;\n");
    await runGit(repository, "commit", "--all", "--quiet", "-m", "revert");

    const cache = await openBlameCache(repository, 2);
    expect(cache.status).toBe("incremental");
    expect(
      (await cache.lookup("a.ts", join(repository, "a.ts"))).histogram,
    ).toBeNull();
    expect(
      (await cache.lookup("b.ts", join(repository, "b.ts"))).histogram,
    ).toEqual({
      Bob: 1,
    });
  });

  test("uses a cold cache after a merge", async () => {
    const repository = await createRepository();
    await populate(repository);
    const original = await runGit(repository, "rev-parse", "HEAD");
    await runGit(repository, "checkout", "--quiet", "-b", "side");
    await writeFile(join(repository, "side.ts"), "side\n");
    await runGit(repository, "add", "side.ts");
    await runGit(repository, "commit", "--quiet", "-m", "side");
    await runGit(repository, "checkout", "--quiet", "-b", "mainline", original);
    await writeFile(join(repository, "main.ts"), "main\n");
    await runGit(repository, "add", "main.ts");
    await runGit(repository, "commit", "--quiet", "-m", "main");
    await runGit(repository, "merge", "--quiet", "--no-edit", "side");

    const cache = await openBlameCache(repository, 2);
    expect(cache.status).toBe("cold");
    expect(cache.invalidationReason).toContain("merge");
  });

  test("uses a cold cache after history diverges", async () => {
    const repository = await createRepository();
    const base = await runGit(repository, "rev-parse", "HEAD");
    await writeFile(join(repository, "cached.ts"), "cached\n");
    await runGit(repository, "add", "cached.ts");
    await runGit(repository, "commit", "--quiet", "-m", "cached branch");
    await populate(repository);
    await runGit(repository, "checkout", "--quiet", "-b", "replacement", base);
    await writeFile(join(repository, "replacement.ts"), "replacement\n");
    await runGit(repository, "add", "replacement.ts");
    await runGit(repository, "commit", "--quiet", "-m", "replacement");

    const cache = await openBlameCache(repository, 2);
    expect(cache.status).toBe("cold");
    expect(cache.invalidationReason).toContain("not an ancestor");
  });

  test("tracks both sides of renames during a linear advance", async () => {
    const repository = await createRepository();
    await populate(repository);
    await runGit(repository, "mv", "a.ts", "renamed.ts");
    await runGit(repository, "commit", "--quiet", "-m", "rename");

    const cache = await openBlameCache(repository, 2);
    expect(cache.status).toBe("incremental");
    expect(cache.invalidationReason).toBe(
      "2 path(s) changed since cached HEAD",
    );
  });

  test("invalidates incompatible depth and supports refresh", async () => {
    const repository = await createRepository();
    await populate(repository);

    const differentDepth = await openBlameCache(repository, 1);
    expect(differentDepth.status).toBe("cold");
    expect(differentDepth.invalidationReason).toContain("signature");

    const refreshed = await openBlameCache(repository, 2, { refresh: true });
    expect(refreshed.status).toBe("cold");
    expect(refreshed.invalidationReason).toBe("refresh requested");
  });

  test("reports schema and parser incompatibility", async () => {
    const repository = await createRepository();
    await populate(repository);
    const path = await cacheFile(repository);
    const manifest = JSON.parse(await readFile(path, "utf8"));

    await writeFile(path, JSON.stringify({ ...manifest, schemaVersion: 0 }));
    expect((await openBlameCache(repository, 2)).invalidationReason).toBe(
      "cache schema is incompatible",
    );

    manifest.signature.parserVersion = 0;
    await writeFile(path, JSON.stringify(manifest));
    expect((await openBlameCache(repository, 2)).invalidationReason).toBe(
      "blame parser version changed",
    );
  });

  test("fingerprints working-tree mailmap and configured auxiliary files", async () => {
    const repository = await createRepository();
    const mailmap = join(repository, ".mailmap");
    const configuredMailmap = join(repository, "custom.mailmap");
    const ignoredRevisions = join(repository, ".git-blame-ignore-revs");
    await writeFile(mailmap, "Ada <ada@example.com>\n");
    await writeFile(configuredMailmap, "Grace <grace@example.com>\n");
    await writeFile(ignoredRevisions, "");
    await runGit(repository, "config", "mailmap.file", "custom.mailmap");
    await runGit(
      repository,
      "config",
      "blame.ignoreRevsFile",
      ".git-blame-ignore-revs",
    );
    const baseline = await createSignature(repository, 2);

    await writeFile(mailmap, "Changed <changed@example.com>\n");
    expect(await createSignature(repository, 2)).not.toEqual(baseline);
    await writeFile(mailmap, "Ada <ada@example.com>\n");

    await writeFile(configuredMailmap, "Changed <changed@example.com>\n");
    expect(await createSignature(repository, 2)).not.toEqual(baseline);
    await writeFile(configuredMailmap, "Grace <grace@example.com>\n");

    await writeFile(ignoredRevisions, `${"0".repeat(40)}\n`);
    expect(await createSignature(repository, 2)).not.toEqual(baseline);
  });

  test("fingerprints configured mailmap blobs across commits", async () => {
    const repository = await createRepository();
    const blobMailmap = join(repository, "blob.mailmap");
    await writeFile(blobMailmap, "Ada <ada@example.com>\n");
    await runGit(repository, "add", "blob.mailmap");
    await runGit(repository, "commit", "--quiet", "-m", "mailmap blob");
    await runGit(repository, "config", "mailmap.blob", "HEAD:blob.mailmap");
    const baseline = await createSignature(repository, 2);

    await writeFile(blobMailmap, "Grace <grace@example.com>\n");
    await runGit(repository, "commit", "--all", "--quiet", "-m", "update blob");

    expect(await createSignature(repository, 2)).not.toEqual(baseline);
  });

  test("missing configured auxiliary inputs leave caching available", async () => {
    const repository = await createRepository();
    await runGit(repository, "config", "mailmap.file", "missing.mailmap");
    await runGit(repository, "config", "mailmap.blob", "HEAD:missing.mailmap");
    await runGit(
      repository,
      "config",
      "blame.ignoreRevsFile",
      "missing-ignore-revs",
    );

    await expect(createSignature(repository, 2)).resolves.toBeDefined();
    expect((await openBlameCache(repository, 2)).status).toBe("cold");
  });

  test("corruption is non-fatal and warns once", async () => {
    const repository = await createRepository();
    const path = await cacheFile(repository);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "not json");
    const warnings: string[] = [];

    const cache = await openBlameCache(repository, 2, {
      onWarning: (warning) => warnings.push(warning),
    });
    expect(cache.status).toBe("cold");
    expect(cache.invalidationReason).toBe("cache manifest is corrupt");
    expect(warnings).toHaveLength(1);
  });

  test("does not cache failed blame results or retain unselected files", async () => {
    const repository = await createRepository();
    await populate(repository);

    const selected = await openBlameCache(repository, 2);
    await selected.lookup("a.ts", join(repository, "a.ts"));
    await selected.save();
    const manifest = JSON.parse(
      await readFile(await cacheFile(repository), "utf8"),
    );
    expect(Object.keys(manifest.entries)).toEqual(["a.ts"]);

    const failed = await openBlameCache(repository, 2, { refresh: true });
    await failed.lookup("a.ts", join(repository, "a.ts"));
    await failed.save();
    const next = await openBlameCache(repository, 2);
    expect(
      (await next.lookup("a.ts", join(repository, "a.ts"))).histogram,
    ).toBeNull();
  });

  test("does not rewrite a fully warm unchanged manifest", async () => {
    const repository = await createRepository();
    await populate(repository);
    const path = await cacheFile(repository);
    const before = await stat(path);
    await Bun.sleep(10);

    const cache = await openBlameCache(repository, 2);
    await cache.lookup("a.ts", join(repository, "a.ts"));
    await cache.lookup("b.ts", join(repository, "b.ts"));
    await cache.save();

    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  });

  test("does not publish a file or manifest after inputs change", async () => {
    const repository = await createRepository();
    const cache = await openBlameCache(repository, 2);
    const lookup = await cache.lookup("a.ts", join(repository, "a.ts"));
    await writeFile(join(repository, "a.ts"), "changed during blame\n");
    await cache.record("a.ts", join(repository, "a.ts"), lookup.digest, {
      Ada: 1,
    });
    await writeFile(join(repository, "head.ts"), "head\n");
    await runGit(repository, "add", "head.ts");
    await runGit(repository, "commit", "--quiet", "-m", "head changed");
    await cache.save();

    expect(await Bun.file(await cacheFile(repository)).exists()).toBe(false);
  });

  test("write failures are non-fatal and warn once", async () => {
    const repository = await createRepository();
    const path = await cacheFile(repository);
    await writeFile(dirname(path), "blocks cache directory");
    const warnings: string[] = [];
    const cache = await openBlameCache(repository, 2, {
      onWarning: (warning) => warnings.push(warning),
    });
    const lookup = await cache.lookup("a.ts", join(repository, "a.ts"));
    await cache.record("a.ts", join(repository, "a.ts"), lookup.digest, {
      Ada: 1,
    });

    await expect(cache.save()).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});
