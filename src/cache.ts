import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type BlameSignature,
  type CacheEntry,
  digestFile,
  MANIFEST_NAME,
  parseManifest,
  SCHEMA_VERSION,
  serializeManifest,
} from "./cache-manifest.js";
import { normalizeCachePath } from "./cache-path.js";
import {
  createSignature,
  runGit,
  successfulGit,
  touchedPaths,
} from "./cache-repository.js";
import type { AuthorHistogram, BlameDepth } from "./git.js";

type CacheStatus = "cold" | "warm" | "incremental" | "disabled";

interface CacheOptions {
  refresh?: boolean;
  onWarning?: (message: string) => void;
}

export interface CacheLookup {
  digest: string | null;
  histogram: AuthorHistogram | null;
}

export class BlameCache {
  readonly stats = { hits: 0, misses: 0 };
  readonly path: string;
  readonly status: CacheStatus;
  readonly invalidationReason?: string;

  private readonly initialHead: string | null;
  private readonly signature: BlameSignature | null;
  private readonly availableEntries: Record<string, CacheEntry>;
  private readonly selectedEntries = Object.create(null) as Record<
    string,
    CacheEntry
  >;
  private readonly selectedPaths = new Set<string>();
  private readonly originalContents: string | null;
  private warned = false;

  constructor(parameters: {
    targetDir: string;
    path: string;
    status: CacheStatus;
    invalidationReason?: string;
    initialHead: string | null;
    signature: BlameSignature | null;
    availableEntries?: Record<string, CacheEntry>;
    originalContents?: string | null;
    onWarning?: (message: string) => void;
  }) {
    this.targetDir = parameters.targetDir;
    this.path = parameters.path;
    this.status = parameters.status;
    this.invalidationReason = parameters.invalidationReason;
    this.initialHead = parameters.initialHead;
    this.signature = parameters.signature;
    this.availableEntries =
      parameters.availableEntries ??
      (Object.create(null) as Record<string, CacheEntry>);
    this.originalContents = parameters.originalContents ?? null;
    this.onWarning = parameters.onWarning;
  }

  private readonly targetDir: string;
  private readonly onWarning?: (message: string) => void;

  private warn(message: string): void {
    if (this.warned) return;
    this.warned = true;
    this.onWarning?.(message);
  }

  async lookup(relativePath: string, filePath: string): Promise<CacheLookup> {
    const cachePath = normalizeCachePath(relativePath);
    this.selectedPaths.add(cachePath);
    let digest: string;
    try {
      digest = await digestFile(filePath);
    } catch (error) {
      this.stats.misses++;
      this.warn(`Cache could not read a selected file: ${String(error)}`);
      return { digest: null, histogram: null };
    }

    const entry = this.availableEntries[cachePath];
    if (entry?.digest === digest) {
      this.stats.hits++;
      this.selectedEntries[cachePath] = entry;
      return { digest, histogram: entry.histogram };
    }

    this.stats.misses++;
    return { digest, histogram: null };
  }

  async record(
    relativePath: string,
    filePath: string,
    originalDigest: string | null,
    histogram: AuthorHistogram,
  ): Promise<void> {
    if (!originalDigest || !this.initialHead || !this.signature) return;
    try {
      if ((await digestFile(filePath)) === originalDigest) {
        this.selectedEntries[normalizeCachePath(relativePath)] = {
          digest: originalDigest,
          histogram,
        };
      }
    } catch (error) {
      this.warn(`Cache could not verify a selected file: ${String(error)}`);
    }
  }

  async save(): Promise<void> {
    if (!this.initialHead || !this.signature || this.status === "disabled")
      return;

    try {
      const currentHead = await successfulGit(this.targetDir, [
        "rev-parse",
        "--verify",
        "HEAD^{commit}",
      ]);
      if (currentHead !== this.initialHead) return;

      const entries = Object.fromEntries(
        [...this.selectedPaths]
          .filter((path) => this.selectedEntries[path])
          .map((path) => [path, this.selectedEntries[path] as CacheEntry]),
      );
      const contents = serializeManifest({
        schemaVersion: SCHEMA_VERSION,
        head: this.initialHead,
        signature: this.signature,
        entries,
      });
      if (contents === this.originalContents) return;

      await mkdir(dirname(this.path), { recursive: true });
      const tempPath = join(
        dirname(this.path),
        `.${MANIFEST_NAME}.${randomUUID()}.tmp`,
      );
      try {
        await writeFile(tempPath, contents, { flag: "wx" });
        await rename(tempPath, this.path);
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      this.warn(`Cache could not be saved: ${String(error)}`);
    }
  }
}

export async function openBlameCache(
  targetDir: string,
  blameDepth: BlameDepth,
  options: CacheOptions = {},
): Promise<BlameCache> {
  let warned = false;
  const warnOnce = (message: string) => {
    if (warned) return;
    warned = true;
    options.onWarning?.(message);
  };

  let path = join(targetDir, ".git", "gala-cache", MANIFEST_NAME);
  let head: string | null = null;
  let signature: BlameSignature | null = null;

  try {
    const commonDir = await successfulGit(targetDir, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    path = join(commonDir, "gala-cache", MANIFEST_NAME);
    head = await successfulGit(targetDir, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ]);
    signature = await createSignature(targetDir, blameDepth);
  } catch (error) {
    warnOnce(`Cache is unavailable: ${String(error)}`);
    return new BlameCache({
      targetDir,
      path,
      status: "disabled",
      invalidationReason: "repository metadata is unavailable",
      initialHead: head,
      signature,
      onWarning: warnOnce,
    });
  }

  if (options.refresh) {
    try {
      await rm(path, { force: true });
    } catch (error) {
      warnOnce(`Cache could not be refreshed: ${String(error)}`);
    }
    return new BlameCache({
      targetDir,
      path,
      status: "cold",
      invalidationReason: "refresh requested",
      initialHead: head,
      signature,
      onWarning: warnOnce,
    });
  }

  let originalContents: string;
  try {
    originalContents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnOnce(`Cache could not be read: ${String(error)}`);
    }
    return new BlameCache({
      targetDir,
      path,
      status: "cold",
      invalidationReason: "no cache manifest",
      initialHead: head,
      signature,
      onWarning: warnOnce,
    });
  }

  const parsed = parseManifest(originalContents);
  if ("reason" in parsed) {
    if (parsed.reason === "cache manifest is corrupt") {
      warnOnce("Cache manifest is corrupt; rebuilding it");
    }
    return new BlameCache({
      targetDir,
      path,
      status: "cold",
      invalidationReason: parsed.reason,
      initialHead: head,
      signature,
      onWarning: warnOnce,
    });
  }
  const { manifest } = parsed;

  if (JSON.stringify(manifest.signature) !== JSON.stringify(signature)) {
    return new BlameCache({
      targetDir,
      path,
      status: "cold",
      invalidationReason: "blame signature changed",
      initialHead: head,
      signature,
      onWarning: warnOnce,
    });
  }

  try {
    const shallow = await runGit(targetDir, [
      "rev-parse",
      "--is-shallow-repository",
    ]);
    if (shallow.exitCode !== 0 || shallow.stdout.trim() === "true") {
      return new BlameCache({
        targetDir,
        path,
        status: "cold",
        invalidationReason: "shallow or incomplete ancestry",
        initialHead: head,
        signature,
        onWarning: warnOnce,
      });
    }

    if (manifest.head === head) {
      return new BlameCache({
        targetDir,
        path,
        status: "warm",
        initialHead: head,
        signature,
        availableEntries: manifest.entries,
        originalContents,
        onWarning: warnOnce,
      });
    }

    const ancestor = await runGit(targetDir, [
      "merge-base",
      "--is-ancestor",
      manifest.head,
      head,
    ]);
    if (ancestor.exitCode !== 0) {
      return new BlameCache({
        targetDir,
        path,
        status: "cold",
        invalidationReason: "cached HEAD is not an ancestor",
        initialHead: head,
        signature,
        onWarning: warnOnce,
      });
    }

    const merges = await runGit(targetDir, [
      "rev-list",
      "--merges",
      `${manifest.head}..${head}`,
    ]);
    if (merges.exitCode !== 0 || merges.stdout.trim()) {
      return new BlameCache({
        targetDir,
        path,
        status: "cold",
        invalidationReason: "merge commit in cached HEAD range",
        initialHead: head,
        signature,
        onWarning: warnOnce,
      });
    }

    const touched = await touchedPaths(targetDir, manifest.head, head);
    const entries = Object.create(null) as Record<string, CacheEntry>;
    for (const [entryPath, entry] of Object.entries(manifest.entries)) {
      if (!touched.has(entryPath)) entries[entryPath] = entry;
    }
    return new BlameCache({
      targetDir,
      path,
      status: "incremental",
      invalidationReason: `${touched.size} path(s) changed since cached HEAD`,
      initialHead: head,
      signature,
      availableEntries: entries,
      originalContents,
      onWarning: warnOnce,
    });
  } catch (error) {
    warnOnce(`Cache ancestry could not be inspected: ${String(error)}`);
    return new BlameCache({
      targetDir,
      path,
      status: "cold",
      invalidationReason: "ancestry inspection failed",
      initialHead: head,
      signature,
      onWarning: warnOnce,
    });
  }
}
