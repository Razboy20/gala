#!/usr/bin/env bun

import { relative, resolve } from "node:path";
import chalk from "chalk";
import { openBlameCache } from "./cache.js";
import { findFiles, resolveGitRepository } from "./files.js";
import {
  type AuthorHistogram,
  type BlameDepth,
  createAuthorHistogram,
  getAuthorHistogram,
} from "./git.js";
import { createProgressBar, log } from "./logger.js";
import {
  displayGeneralContributions,
  displayUserContributions,
} from "./output.js";
import { processWithPool } from "./processor.js";
import {
  cleanupTempDir,
  cloneRepository,
  isRemoteUrl,
  type RemoteOptions,
  setupCleanupHandler,
} from "./remote.js";

if (process.argv.includes("-h") || process.argv.includes("--help")) {
  console.log(`
${chalk.bold.cyan("Gala (Git Author Line Analyzer)")}
${chalk.dim("Analyzes git blame data to show author contributions by line count")}

${chalk.bold("Usage:")}
  bun gala.ts [directory|remote-url] [username] [options]

${chalk.bold("Arguments:")}
  ${chalk.green("directory")}    Target directory to analyze (default: current directory)
               Must be a git repository
  ${chalk.green("remote-url")}   Remote git repository URL (https://, git@, etc.)
               Will be cloned to temporary directory
  ${chalk.green("username")}     Optional: Show per-file line count for specific user

${chalk.bold("Options:")}
  ${chalk.yellow("-h, --help")}            Show this help message
  ${chalk.yellow("--branch <name>")}       Clone specific branch (remote repos only)
  ${chalk.yellow("--tag <name>")}          Clone specific tag (remote repos only)
  ${chalk.yellow("-e, --exclude <glob>")}  Exclude files/directories matching glob
                        (repeatable, e.g. -e "docs/**" -e "**/*.test.ts")
  ${chalk.yellow("-i, --include <glob>")}  Include only matching files/directories
                        (repeatable; exclusions still take precedence)
  ${chalk.yellow("--blame-depth <0-4>")}   Copy/move detection depth (default: 2)
                        0 fastest; 4 most thorough
  ${chalk.yellow("--verbose")}             Show cache path, status, and hit/miss details
  ${chalk.yellow("--refresh-cache")}       Rebuild the local repository cache

${chalk.bold("Examples:")}
  ${chalk.dim("# Show all authors across all files")}
  bun gala.ts

  ${chalk.dim("# Analyze specific directory")}
  bun gala.ts /path/to/project

  ${chalk.dim("# Analyze remote repository")}
  bun gala.ts https://github.com/user/repo

  ${chalk.dim("# Analyze specific branch of remote repo")}
  bun gala.ts https://github.com/user/repo --branch develop

  ${chalk.dim("# Show specific user's contributions per file")}
  bun gala.ts . "John Doe"

  ${chalk.dim("# Analyze user in remote repository")}
  bun gala.ts git@github.com:user/repo.git "Jane Doe"
`);
  process.exit(0);
}

// Parses command line arguments and extracts target, user, and options
function parseArgs() {
  const args = process.argv.slice(2);
  const options: RemoteOptions = {};
  const excludes: string[] = [];
  const includes: string[] = [];
  let blameDepth: BlameDepth = 2;
  let verbose = false;
  let refreshCache = false;
  let target: string | undefined;
  let user: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;

    if (arg === "--branch" && i + 1 < args.length) {
      options.branch = args[i + 1];
      i++;
    } else if (arg === "--tag" && i + 1 < args.length) {
      options.tag = args[i + 1];
      i++;
    } else if ((arg === "-e" || arg === "--exclude") && i + 1 < args.length) {
      excludes.push(args[i + 1] as string);
      i++;
    } else if ((arg === "-i" || arg === "--include") && i + 1 < args.length) {
      includes.push(args[i + 1] as string);
      i++;
    } else if (arg === "--blame-depth" && i + 1 < args.length) {
      const value = Number(args[i + 1]);
      if (!Number.isInteger(value) || value < 0 || value > 4) {
        throw new Error("--blame-depth must be an integer from 0 to 4");
      }
      blameDepth = value as BlameDepth;
      i++;
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--refresh-cache") {
      refreshCache = true;
    } else if (!arg.startsWith("-")) {
      if (!target) {
        target = arg;
      } else if (!user) {
        user = arg;
      }
    }
  }

  if (!target) target = ".";

  return {
    target,
    user,
    options,
    excludes,
    includes,
    blameDepth,
    verbose,
    refreshCache,
  };
}

const {
  target,
  user: targetUser,
  options: remoteOptions,
  excludes: extraExcludes,
  includes,
  blameDepth,
  verbose,
  refreshCache,
} = parseArgs();

log.header("Gala");

// Handles remote repository vs local directory processing
let targetDir: string;
let isRemote = false;
let tempDir: string | null = null;

if (isRemoteUrl(target)) {
  isRemote = true;
  try {
    tempDir = await cloneRepository(target, remoteOptions);
    targetDir = tempDir;
    setupCleanupHandler(tempDir);

    log.info(`Analyzing remote repository: ${chalk.cyan(target)}`);
  } catch (error) {
    log.error(`Failed to clone repository: ${error}`);
    process.exit(1);
  }
} else {
  const resolvedTarget = resolve(target);
  targetDir = await resolveGitRepository(resolvedTarget);

  if (targetDir !== resolvedTarget) {
    log.info(`Detected git repository root: ${chalk.cyan(targetDir)}`);
  }

  log.info(`Scanning directory: ${chalk.cyan(targetDir)}`);
}

if (targetUser) {
  log.info(`Analyzing contributions by user: ${chalk.magenta(targetUser)}`);
}

if (extraExcludes.length > 0) {
  log.info(
    `Excluding ${chalk.yellow(extraExcludes.length)} extra pattern(s): ${chalk.dim(extraExcludes.join(", "))}`,
  );
}

if (includes.length > 0) {
  log.info(
    `Including ${chalk.yellow(includes.length)} pattern(s): ${chalk.dim(includes.join(", "))}`,
  );
}

log.info(
  `Using blame depth ${chalk.yellow(blameDepth)} (0 fastest, 4 most thorough)`,
);

const files: string[] = await findFiles(targetDir, extraExcludes, includes);

const cache = isRemote
  ? null
  : await openBlameCache(targetDir, blameDepth, {
      refresh: refreshCache,
      onWarning: (warning) => log.warn(warning),
    });

if (verbose) {
  if (cache) {
    log.info(`Cache path: ${chalk.dim(cache.path)}`);
    log.info(`Cache status: ${chalk.yellow(cache.status)}`);
    log.info(
      `Cache invalidation: ${chalk.dim(cache.invalidationReason ?? "none")}`,
    );
  } else {
    log.info("Cache status: bypassed for temporary remote clone");
  }
}

async function histogramForFile(file: string): Promise<AuthorHistogram> {
  const relativePath = relative(targetDir, file);
  const lookup = cache
    ? await cache.lookup(relativePath, file)
    : { digest: null, histogram: null };
  if (lookup.histogram) return lookup.histogram;

  const histogram = await getAuthorHistogram(file, targetDir, blameDepth);
  if (!histogram) return createAuthorHistogram();
  if (cache) {
    await cache.record(relativePath, file, lookup.digest, histogram);
  }
  return histogram;
}

console.log(`Found ${chalk.green(files.length)} files to analyze...`);

if (files.length === 0) {
  log.warn("No files found to analyze!");
  process.exit(0);
}

const CONCURRENCY_LIMIT = 50;

log.header("📊 Processing Files");

// Process files for specific user or all authors
if (targetUser) {
  const userFileContributions = Object.create(null) as Record<string, number>;
  let processedCount = 0;

  const updateProgress = () => {
    processedCount++;
    const progress = createProgressBar(processedCount, files.length);
    process.stdout.write(`\r${progress}`);
  };

  const processor = async (file: string) => {
    const relativePath = relative(targetDir, file);
    const histogram = await histogramForFile(file);
    const count = histogram[targetUser] ?? 0;
    if (count > 0) {
      userFileContributions[relativePath] = count;
    }
    return { file, count };
  };

  await processWithPool(files, CONCURRENCY_LIMIT, processor, updateProgress);

  console.log();

  await cache?.save();
  if (verbose && cache) {
    log.info(`Cache hits: ${cache.stats.hits}; misses: ${cache.stats.misses}`);
  }

  displayUserContributions(
    userFileContributions,
    targetUser,
    targetDir,
    files.length,
  );
} else {
  const authorCounts = createAuthorHistogram();
  let processedCount = 0;

  const updateProgress = () => {
    processedCount++;
    const progress = createProgressBar(processedCount, files.length);
    process.stdout.write(`\r${progress}`);
  };

  const processor = async (file: string) => {
    const histogram = await histogramForFile(file);
    for (const [author, count] of Object.entries(histogram)) {
      authorCounts[author] = (authorCounts[author] ?? 0) + count;
    }
    return histogram;
  };

  await processWithPool(files, CONCURRENCY_LIMIT, processor, updateProgress);

  console.log();

  await cache?.save();
  if (verbose && cache) {
    log.info(`Cache hits: ${cache.stats.hits}; misses: ${cache.stats.misses}`);
  }

  displayGeneralContributions(authorCounts, files.length);
}

// Cleanup temporary directory if it was a remote repository
if (isRemote && tempDir) {
  cleanupTempDir(tempDir);
}
