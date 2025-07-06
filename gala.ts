#!/usr/bin/env bun

import { Glob } from "bun";
import { join, resolve, relative } from "path";
import { existsSync, statSync } from "fs";
import chalk from "chalk";
import Table from "cli-table3";

// Helper functions for styled output
const log = {
  info: (msg: string) => console.log(`${chalk.blue("ℹ")} ${msg}`),
  success: (msg: string) => console.log(`${chalk.green("✓")} ${msg}`),
  warn: (msg: string) => console.log(`${chalk.yellow("⚠")} ${msg}`),
  error: (msg: string) => console.log(`${chalk.red("✗")} ${msg}`),
  header: (msg: string) => console.log(`\n${chalk.bold.cyan(msg)}`),
  dim: (msg: string) => console.log(chalk.dim(msg)),
};

// Progress bar function
function createProgressBar(
  current: number,
  total: number,
  width: number = 25,
): string {
  const percentage = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;

  const bar = `${chalk.green("█".repeat(filled))}${chalk.gray("░".repeat(empty))}`;
  return `${bar} ${chalk.bold(`${percentage}%`)} (${current.toLocaleString()}/${total.toLocaleString()})`;
}

// Show usage if help flag is provided
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

// Get target directory and optional username from command line arguments
const targetDir: string = resolve(process.argv[2] || ".");
const targetUser: string | undefined = process.argv[3];

// Validate target directory using standard Node.js fs methods
function validateDirectory(dir: string): void {
  if (!existsSync(dir)) {
    log.error(`Directory "${chalk.cyan(dir)}" does not exist`);
    process.exit(1);
  }

  if (!statSync(dir).isDirectory()) {
    log.error(`"${chalk.cyan(dir)}" is not a directory`);
    process.exit(1);
  }

  // Check if it's a git repository
  const gitDir = join(dir, ".git");
  if (!existsSync(gitDir)) {
    log.error(`"${chalk.cyan(dir)}" is not a git repository`);
    process.exit(1);
  }
}

log.header("🔍 GALA - Git Author Line Analyzer");

validateDirectory(targetDir);

// File patterns to exclude (converted from bash globs)
// Note that these patterns are in addition to those ignored in .gitignore
const excludePatterns: string[] = [
  // Lock files
  "**/*-lock.*",
  "**/*.lock",

  // Image files
  "**/*.gif",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.webp",
  "**/*.ico",
  "**/*.tiff",
  "**/*.tif",
  "**/*.bmp",
  "**/*.svg",

  // Font files
  "**/*.woff",
  "**/*.woff2",
  "**/*.ttf",
  "**/*.otf",
  "**/*.eot",

  // Video/Audio files
  "**/*.mp4",
  "**/*.avi",
  "**/*.mov",
  "**/*.wmv",
  "**/*.flv",
  "**/*.webm",
  "**/*.mp3",
  "**/*.wav",
  "**/*.flac",
  "**/*.aac",
  "**/*.ogg",

  // Archive files
  "**/*.zip",
  "**/*.tar",
  "**/*.tgz",
  "**/*.rar",
  "**/*.7z",
  "**/*.gz",
  "**/*.bz2",
  "**/*.xz",

  // Binary/Executable files
  "**/*.exe",
  "**/*.dll",
  "**/*.so",
  "**/*.dylib",
  "**/*.bin",
  "**/*.deb",
  "**/*.rpm",
  "**/*.dmg",
  "**/*.pkg",
  "**/*.msi",

  // Database files
  "**/*.db",
  "**/*.sqlite",
  "**/*.sqlite3",
  "**/*.mdb",

  // Document files (often binary)
  "**/*.pdf",
  "**/*.doc",
  "**/*.docx",
  "**/*.xls",
  "**/*.xlsx",
  "**/*.ppt",
  "**/*.pptx",

  // Compiled/Build artifacts
  "**/*.o",
  "**/*.obj",
  "**/*.class",
  "**/*.pyc",
  "**/*.pyo",
  "**/*.pyd",
  "**/*.a",
  "**/*.lib",
  "**/*.jar",
  "**/*.war",
  "**/*.ear",

  // Minified files
  "**/*.min.js",
  "**/*.min.css",
  "**/*.min.html",

  // OS generated files
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/desktop.ini",
  "**/.directory",

  // IDE/Editor files
  "**/.vscode/**",
  "**/.zed/**",
  "**/.idea/**",
  "**/.vs/**",
  "**/nbproject/**",
  "**/*.swp",
  "**/*.swo",
  "**/*~",

  // Dependency directories
  "**/node_modules/**",
  "**/vendor/**",
  "**/bower_components/**",
  "**/.npm/**",
  "**/.yarn/**",

  // Build/Cache directories
  // "**/dist/**",
  // "**/build/**",
  // "**/target/**",
  "**/.cache/**",
  "**/.tmp/**",
  "**/.temp/**",
  // "**/tmp/**",
  // "**/temp/**",
  "**/__pycache__/**",
  "**/.pytest_cache/**",
  "**/coverage/**",
  "**/.nyc_output/**",

  // Version control
  "**/.git/**",
  "**/.hg/**",
  "**/.svn/**",

  // Log files
  "**/*.log",
  "**/*.logs",
  "**/logs/**",

  // Certificate and key files
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.crt",
  "**/*.cer",

  // Backup files
  "**/*.bak",
  "**/*.backup",
  "**/*.orig",
];

// Read and parse .gitignore files
async function parseGitignore(dir: string): Promise<string[]> {
  const gitignorePatterns: string[] = [];

  try {
    const gitignoreFile = Bun.file(join(dir, ".gitignore"));
    const exists = await gitignoreFile.exists();

    if (!exists) {
      return gitignorePatterns;
    }

    const gitignoreContent = await gitignoreFile.text();

    for (let line of gitignoreContent.split("\n")) {
      line = line.trim();

      // Skip empty lines and comments
      if (!line || line.startsWith("#")) continue;

      // Convert gitignore patterns to glob patterns
      let pattern = line;

      // Handle negation patterns (starting with !)
      if (pattern.startsWith("!")) {
        continue; // Skip negation patterns for simplicity
      }

      // Handle directory patterns (ending with /)
      if (pattern.endsWith("/")) {
        pattern = pattern.slice(0, -1) + "/**";
      }

      // Add ** prefix if pattern doesn't start with / or contain /
      if (!pattern.startsWith("/") && !pattern.includes("/")) {
        pattern = "**/" + pattern;
      }

      // Remove leading slash
      if (pattern.startsWith("/")) {
        pattern = pattern.slice(1);
      }

      gitignorePatterns.push(pattern);
    }
  } catch (error) {
    // .gitignore doesn't exist or can't be read, continue without it
    log.dim(`Note: Could not read .gitignore (${error})`);
  }

  return gitignorePatterns;
}

// Get gitignore patterns
const gitignorePatterns: string[] = await parseGitignore(targetDir);
const allExcludePatterns: string[] = [...excludePatterns, ...gitignorePatterns];

log.info(`Scanning directory: ${chalk.cyan(targetDir)}`);
if (targetUser) {
  log.info(`Analyzing contributions by user: ${chalk.magenta(targetUser)}`);
}
if (gitignorePatterns.length > 0) {
  log.success(
    `Loaded ${chalk.yellow(gitignorePatterns.length)} patterns from .gitignore`,
  );
}

// Find all files excluding the specified patterns
const glob = new Glob("**/*");
const files: string[] = [];

for await (const file of glob.scan(targetDir)) {
  // Check if file matches any exclude pattern
  const shouldExclude = allExcludePatterns.some((pattern: string) => {
    const excludeGlob = new Glob(pattern);
    return excludeGlob.match(file);
  });

  if (!shouldExclude) {
    const fullPath = join(targetDir, file);
    // Use Node.js fs to check if it's a regular file
    try {
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        files.push(fullPath);
      }
    } catch {
      // Skip files we can't access
    }
  }
}

console.log(`Found ${chalk.green(files.length)} files to analyze...`);

if (files.length === 0) {
  log.warn("No files found to analyze!");
  process.exit(0);
}

// Function to run git blame on a single file
async function getAuthorsFromFile(
  filepath: string,
  filterUser?: string,
): Promise<string[] | number> {
  try {
    // Convert to relative path from target directory for git blame
    const relativePath = relative(targetDir, filepath);

    // Run git blame with the following extra flags:
    // -M                : Detect moved lines within the same file
    // -C                : Detect lines copied or moved from other files
    // -w                : Ignore whitespace when comparing the parent's version and the child's to find where the lines came from
    const proc = Bun.spawn(
      ["git", "blame", "-M", "-C", "-w", "--line-porcelain", relativePath],
      {
        cwd: targetDir,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    // Extract author lines
    const authors: string[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      if (line.startsWith("author ")) {
        authors.push(line.substring(7));
      }
    }

    // If filtering for a specific user, return count of their lines
    if (filterUser) {
      return authors.filter((author) => author === filterUser).length;
    }

    // Otherwise return all authors
    return authors;
  } catch (error) {
    return filterUser ? 0 : [];
  }
}

// Process files in parallel batches to avoid overwhelming the system
// todo: don't batch, just have a single progress bar that updates as each file is processed (and pools them instead)
const BATCH_SIZE = 50;

log.header("📊 Processing Files");

if (targetUser) {
  // User-specific mode: track lines per file
  const userFileContributions: Record<string, number> = {};

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(files.length / BATCH_SIZE);

    const progress = createProgressBar(i + batch.length, files.length);
    // Clear the line and write progress (padding ensures clean overwrite)
    process.stdout.write(
      `\r${chalk.blue("⚡")} Batch ${chalk.cyan(batchNum)}/${chalk.cyan(totalBatches)} ${progress}`.padEnd(
        80,
      ),
    );

    // Run git blame in parallel for this batch
    const batchPromises = batch.map((file: string) =>
      getAuthorsFromFile(file, targetUser).then((result) => ({
        file,
        count: result as number,
      })),
    );
    const batchResults = await Promise.all(batchPromises);

    // Store results for files with contributions
    for (const { file, count } of batchResults) {
      if (count > 0) {
        const relativePath = relative(targetDir, file);
        userFileContributions[relativePath] = count;
      }
    }
  }

  // Clear progress line
  console.log();

  // Sort by line count descending
  const sortedFiles: [string, number][] = Object.entries(
    userFileContributions,
  ).sort(([, a], [, b]) => b - a);

  // Output results for user mode
  log.header(`📝 ${targetUser}'s Contributions by File`);

  if (sortedFiles.length === 0) {
    log.warn(`No contributions found for user "${chalk.magenta(targetUser)}"`);
  } else {
    // Create a pretty table using cli-table3
    const table = new Table({
      head: [chalk.bold("Lines"), chalk.bold("File")],
      colWidths: [10, 80],
      style: {
        head: ["cyan"],
        border: ["gray"],
      },
      chars: {
        mid: "",
        "left-mid": "",
        "mid-mid": "",
        "right-mid": "",
      },
      wordWrap: true,
    });

    // Add top 20 files to table
    const displayFiles = sortedFiles.slice(0, 20);
    for (const [filepath, count] of displayFiles) {
      table.push([chalk.green(count.toLocaleString()), chalk.cyan(filepath)]);
    }

    console.log("\n" + table.toString());

    if (sortedFiles.length > 20) {
      console.log(chalk.dim(`... and ${sortedFiles.length - 20} more files\n`));
    }
  }

  const totalUserLines = Object.values(userFileContributions).reduce(
    (sum, count) => sum + count,
    0,
  );

  // Summary table
  const summaryTable = new Table({
    style: {
      head: ["cyan"],
      border: ["gray"],
    },
    chars: {
      mid: "",
      "left-mid": "",
      "mid-mid": "",
      "right-mid": "",
    },
  });

  summaryTable.push(
    [
      chalk.green("Total lines by " + targetUser),
      chalk.bold(totalUserLines.toLocaleString()),
    ],
    [
      chalk.blue("Files contributed to"),
      chalk.bold(sortedFiles.length.toString()),
    ],
    [chalk.gray("Files processed"), chalk.bold(files.length.toString())],
  );

  console.log(chalk.bgBlue.white(" SUMMARY "));
  console.log(summaryTable.toString());
} else {
  // General mode: track all authors across all files
  const allAuthors: string[] = [];

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(files.length / BATCH_SIZE);

    const progress = createProgressBar(i + batch.length, files.length);
    // Clear the line and write progress (padding ensures clean overwrite)
    process.stdout.write(
      `\r${chalk.blue("⚡")} Batch ${chalk.cyan(batchNum)}/${chalk.cyan(totalBatches)} ${progress}`.padEnd(
        80,
      ),
    );

    // Run git blame in parallel for this batch
    const batchPromises = batch.map((file: string) => getAuthorsFromFile(file));
    const batchResults = await Promise.all(batchPromises);

    // Flatten results and add to all authors
    for (const authors of batchResults) {
      allAuthors.push(...(authors as string[]));
    }
  }

  // Clear progress line
  console.log();

  // Count authors (equivalent to sort | uniq -c | sort -nr)
  const authorCounts: Record<string, number> = {};
  for (const author of allAuthors) {
    if (author.trim()) {
      // Skip empty authors
      authorCounts[author] = (authorCounts[author] || 0) + 1;
    }
  }

  // Sort by count descending
  const sortedAuthors: [string, number][] = Object.entries(authorCounts).sort(
    ([, a], [, b]) => b - a,
  );

  // Output results for general mode
  log.header("🏆 Author Contributions by Lines");

  if (sortedAuthors.length === 0) {
    log.warn("No authors found!");
  } else {
    // Create a pretty table using cli-table3
    const table = new Table({
      head: [chalk.bold("Rank"), chalk.bold("Lines"), chalk.bold("Author")],
      colWidths: [8, 12, 60],
      style: {
        head: ["cyan"],
        border: ["gray"],
      },
      chars: {
        mid: "",
        "left-mid": "",
        "mid-mid": "",
        "right-mid": "",
      },
      wordWrap: true,
    });

    // Add top 20 authors to table with ranking
    // todo: make configurable
    const displayAuthors = sortedAuthors.slice(0, 20);
    displayAuthors.forEach(([author, count], i) => {
      // Add medal for top 3
      const rank =
        i === 0
          ? "🥇"
          : i === 1
            ? "🥈"
            : i === 2
              ? "🥉"
              : chalk.gray(`${(i + 1).toString().padStart(2)}.`);

      table.push([
        rank,
        chalk.yellow(count.toLocaleString()),
        chalk.magenta(author),
      ]);
    });

    console.log("\n" + table.toString());

    if (sortedAuthors.length > 20) {
      console.log(
        chalk.dim(`... and ${sortedAuthors.length - 20} more authors\n`),
      );
    }
  }

  // Summary table
  const summaryTable = new Table({
    style: {
      head: ["cyan"],
      border: ["gray"],
    },
    chars: {
      mid: "",
      "left-mid": "",
      "mid-mid": "",
      "right-mid": "",
    },
  });

  summaryTable.push(
    [
      chalk.green("Total lines analyzed"),
      chalk.bold(allAuthors.length.toLocaleString()),
    ],
    [chalk.blue("Unique authors"), chalk.bold(sortedAuthors.length.toString())],
    [chalk.gray("Files processed"), chalk.bold(files.length.toString())],
  );

  console.log(chalk.bgGreen.white(" SUMMARY "));
  console.log(summaryTable.toString());
}

// :3
