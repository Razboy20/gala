#!/usr/bin/env bun

import { relative, resolve } from "node:path";
import chalk from "chalk";
import { findFiles, parseGitignore, validateDirectory } from "./files.js";
import { getAuthorsFromFile } from "./git.js";
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
  ${chalk.yellow("-h, --help")}       Show this help message
  ${chalk.yellow("--branch <name>")}  Clone specific branch (remote repos only)
  ${chalk.yellow("--tag <name>")}     Clone specific tag (remote repos only)

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
    } else if (!arg.startsWith("-")) {
      if (target === ".") {
        target = arg;
      } else if (!user) {
        user = arg;
      }
    }
  }

  if (!target) target = ".";

  return { target, user, options };
}

const { target, user: targetUser, options: remoteOptions } = parseArgs();

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
  targetDir = resolve(target);
  validateDirectory(targetDir);
  log.info(`Scanning directory: ${chalk.cyan(targetDir)}`);
}

if (targetUser) {
  log.info(`Analyzing contributions by user: ${chalk.magenta(targetUser)}`);
}

const gitignorePatterns: string[] = await parseGitignore(targetDir);
if (gitignorePatterns.length > 0) {
  log.success(
    `Loaded ${chalk.yellow(gitignorePatterns.length)} patterns from .gitignore`,
  );
}

const files: string[] = await findFiles(targetDir);

console.log(`Found ${chalk.green(files.length)} files to analyze...`);

if (files.length === 0) {
  log.warn("No files found to analyze!");
  process.exit(0);
}

const CONCURRENCY_LIMIT = 50;

log.header("📊 Processing Files");

// Process files for specific user or all authors
if (targetUser) {
  const userFileContributions: Record<string, number> = {};
  let processedCount = 0;

  const updateProgress = () => {
    processedCount++;
    const progress = createProgressBar(processedCount, files.length);
    process.stdout.write(`\r${progress}`);
  };

  const processor = async (file: string) => {
    const result = await getAuthorsFromFile(file, targetDir, targetUser);
    const count = result as number;
    if (count > 0) {
      const relativePath = relative(targetDir, file);
      userFileContributions[relativePath] = count;
    }
    return { file, count };
  };

  await processWithPool(files, CONCURRENCY_LIMIT, processor, updateProgress);

  console.log();

  displayUserContributions(
    userFileContributions,
    targetUser,
    targetDir,
    files.length,
  );
} else {
  const allAuthors: string[] = [];
  let processedCount = 0;

  const updateProgress = () => {
    processedCount++;
    const progress = createProgressBar(processedCount, files.length);
    process.stdout.write(`\r${progress}`);
  };

  const processor = async (file: string) => {
    const result = await getAuthorsFromFile(file, targetDir);
    const authors = result as string[];
    allAuthors.push(...authors);
    return authors;
  };

  await processWithPool(files, CONCURRENCY_LIMIT, processor, updateProgress);

  console.log();

  displayGeneralContributions(allAuthors, files.length);
}

// Cleanup temporary directory if it was a remote repository
if (isRemote && tempDir) {
  cleanupTempDir(tempDir);
}
