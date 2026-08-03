import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { type BlameSignature, PARSER_VERSION } from "./cache-manifest.js";
import { type BlameDepth, buildBlameArgs } from "./git.js";

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runGit(
  targetDir: string,
  args: string[],
): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: targetDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

export async function successfulGit(
  targetDir: string,
  args: string[],
): Promise<string> {
  const result = await runGit(targetDir, args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  }
  return result.stdout.trim();
}

export async function createSignature(
  targetDir: string,
  blameDepth: BlameDepth,
): Promise<BlameSignature> {
  const gitVersion = await successfulGit(targetDir, ["version"]);
  const config = await runGit(targetDir, [
    "config",
    "--null",
    "--get-regexp",
    "^(blame|diff|mailmap)\\.",
  ]);
  if (config.exitCode !== 0 && config.exitCode !== 1) {
    throw new Error(config.stderr.trim() || "could not read Git configuration");
  }

  return {
    parserVersion: PARSER_VERSION,
    blameDepth,
    blameArgs: buildBlameArgs("<path>", blameDepth).slice(1),
    gitVersion,
    gitConfig: config.stdout.split("\0").filter(Boolean).sort(),
    auxiliaryFingerprints: await auxiliaryFingerprints(targetDir),
  };
}

function contentFingerprint(content: string | ArrayBuffer): string {
  return createHash("sha256")
    .update(typeof content === "string" ? content : new Uint8Array(content))
    .digest("hex");
}

async function fileFingerprint(label: string, path: string): Promise<string> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return `${label}:missing`;
    return `${label}:sha256:${contentFingerprint(await file.arrayBuffer())}`;
  } catch (_error) {
    return `${label}:unreadable`;
  }
}

async function configValues(
  targetDir: string,
  key: string,
  pathValues = false,
): Promise<string[]> {
  try {
    const result = await runGit(targetDir, [
      "config",
      "--null",
      ...(pathValues ? ["--path"] : []),
      "--get-all",
      key,
    ]);
    if (result.exitCode === 1) return [];
    if (result.exitCode !== 0) return [`<config-unreadable:${key}>`];
    return result.stdout.split("\0").filter(Boolean);
  } catch (_error) {
    return [`<config-unreadable:${key}>`];
  }
}

async function configuredFileFingerprints(
  targetDir: string,
  key: string,
): Promise<string[]> {
  const values = await configValues(targetDir, key, true);
  return Promise.all(
    values.map((value) => {
      if (value.startsWith("<config-unreadable:")) return value;
      const path = isAbsolute(value) ? value : resolve(targetDir, value);
      return fileFingerprint(`${key}:${value}`, path);
    }),
  );
}

async function blobFingerprints(targetDir: string): Promise<string[]> {
  const values = await configValues(targetDir, "mailmap.blob");
  return Promise.all(
    values.map(async (value) => {
      if (value.startsWith("<config-unreadable:")) return value;
      try {
        const result = await runGit(targetDir, ["cat-file", "blob", value]);
        if (result.exitCode !== 0) return `mailmap.blob:${value}:missing`;
        return `mailmap.blob:${value}:sha256:${contentFingerprint(result.stdout)}`;
      } catch (_error) {
        return `mailmap.blob:${value}:unreadable`;
      }
    }),
  );
}

async function auxiliaryFingerprints(targetDir: string): Promise<string[]> {
  const fingerprints = await Promise.all([
    fileFingerprint(".mailmap", join(targetDir, ".mailmap")),
    configuredFileFingerprints(targetDir, "mailmap.file"),
    configuredFileFingerprints(targetDir, "blame.ignoreRevsFile"),
    blobFingerprints(targetDir),
  ]);
  return fingerprints.flat().sort();
}

export async function touchedPaths(
  targetDir: string,
  oldHead: string,
  newHead: string,
): Promise<Set<string>> {
  const result = await runGit(targetDir, [
    "log",
    "--format=",
    "--name-only",
    "-z",
    "--no-renames",
    `${oldHead}..${newHead}`,
    "--",
  ]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "could not inspect changed paths");
  }
  return new Set(result.stdout.split("\0").filter(Boolean));
}
