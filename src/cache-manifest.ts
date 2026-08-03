import { createHash } from "node:crypto";
import { normalizeCachePath } from "./cache-path.js";
import {
  type AuthorHistogram,
  type BlameDepth,
  createAuthorHistogram,
} from "./git.js";

export const SCHEMA_VERSION = 1;
export const PARSER_VERSION = 2;
export const MANIFEST_NAME = `manifest-v${SCHEMA_VERSION}.json`;

export interface BlameSignature {
  parserVersion: number;
  blameDepth: BlameDepth;
  blameArgs: string[];
  gitVersion: string;
  gitConfig: string[];
  auxiliaryFingerprints: string[];
}

export interface CacheEntry {
  digest: string;
  histogram: AuthorHistogram;
}

export interface CacheManifest {
  schemaVersion: number;
  head: string;
  signature: BlameSignature;
  entries: Record<string, CacheEntry>;
}

export type ManifestParseResult =
  | { manifest: CacheManifest }
  | { reason: "cache schema is incompatible" }
  | { reason: "blame parser version changed" }
  | { reason: "cache manifest is corrupt" };

function isHistogram(value: unknown): value is AuthorHistogram {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (count) =>
      typeof count === "number" && Number.isInteger(count) && count >= 0,
  );
}

function isSignature(value: unknown): value is BlameSignature {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const signature = value as Partial<BlameSignature>;
  return (
    Number.isInteger(signature.parserVersion) &&
    Number.isInteger(signature.blameDepth) &&
    Array.isArray(signature.blameArgs) &&
    signature.blameArgs.every((arg) => typeof arg === "string") &&
    typeof signature.gitVersion === "string" &&
    Array.isArray(signature.gitConfig) &&
    signature.gitConfig.every((entry) => typeof entry === "string") &&
    Array.isArray(signature.auxiliaryFingerprints) &&
    signature.auxiliaryFingerprints.every((entry) => typeof entry === "string")
  );
}

export function parseManifest(contents: string): ManifestParseResult {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (_error) {
    return { reason: "cache manifest is corrupt" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { reason: "cache manifest is corrupt" };
  }
  const manifest = value as Partial<CacheManifest>;
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    return { reason: "cache schema is incompatible" };
  }
  if (
    manifest.signature &&
    typeof manifest.signature === "object" &&
    manifest.signature.parserVersion !== PARSER_VERSION
  ) {
    return { reason: "blame parser version changed" };
  }
  if (
    typeof manifest.head !== "string" ||
    !isSignature(manifest.signature) ||
    !manifest.entries ||
    typeof manifest.entries !== "object" ||
    Array.isArray(manifest.entries)
  ) {
    return { reason: "cache manifest is corrupt" };
  }

  const entries = Object.create(null) as Record<string, CacheEntry>;
  for (const [path, entry] of Object.entries(manifest.entries)) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.digest) ||
      !isHistogram(entry.histogram)
    ) {
      return { reason: "cache manifest is corrupt" };
    }
    const histogram = createAuthorHistogram();
    for (const [author, count] of Object.entries(entry.histogram)) {
      histogram[author] = count;
    }
    entries[normalizeCachePath(path)] = { ...entry, histogram };
  }
  return { manifest: { ...(manifest as CacheManifest), entries } };
}

export async function digestFile(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer();
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

export function serializeManifest(manifest: CacheManifest): string {
  const entries = Object.fromEntries(
    Object.entries(manifest.entries).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return `${JSON.stringify({ ...manifest, entries }, null, 2)}\n`;
}
