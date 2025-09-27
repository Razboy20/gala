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

if (process.argv.includes("-h") || process.argv.includes("--help")) {
  console.log(`
${chalk.bold.cyan("Gala (Git Author Line Analyzer)")}
${chalk.dim("Analyzes git blame data to show author contributions by line count")}

${chalk.bold("Usage:")}
  bun gala.ts [directory] [username]

${chalk.bold("Arguments:")}
  ${chalk.green("directory")}    Target directory to analyze (default: current directory)
               Must be a git repository
  ${chalk.green("username")}     Optional: Show per-file line count for specific user

${chalk.bold("Options:")}
  ${chalk.yellow("-h, --help")}   Show this help message

${chalk.bold("Examples:")}
  ${chalk.dim("# Show all authors across all files")}
  bun gala.ts

  ${chalk.dim("# Analyze specific directory")}
  bun gala.ts /path/to/project

  ${chalk.dim("# Show specific user's contributions per file")}
  bun gala.ts . "John Doe"

  ${chalk.dim("# Analyze user in different directory")}
  bun gala.ts /path/to/repo alice
`);
  process.exit(0);
}

const targetDir: string = resolve(process.argv[2] || ".");
const targetUser: string | undefined = process.argv[3];

log.header("🔍 GALA - Git Author Line Analyzer");

validateDirectory(targetDir);

log.info(`Scanning directory: ${chalk.cyan(targetDir)}`);
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
