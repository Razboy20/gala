import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import chalk from "chalk";
import { log } from "./logger.js";

// File patterns to exclude from analysis (converted from bash globs)
// These patterns are in addition to those ignored in .gitignore
// Excludes binary files, dependencies, build artifacts, and other non-source files
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

// Validates that the given directory exists and is a git repository
export function validateDirectory(dir: string): void {
  if (!existsSync(dir)) {
    log.error(`Directory "${chalk.cyan(dir)}" does not exist`);
    process.exit(1);
  }

  if (!statSync(dir).isDirectory()) {
    log.error(`"${chalk.cyan(dir)}" is not a directory`);
    process.exit(1);
  }

  const gitDir = join(dir, ".git");
  if (!existsSync(gitDir)) {
    log.error(`"${chalk.cyan(dir)}" is not a git repository`);
    process.exit(1);
  }
}

// Reads and parses .gitignore files to extract ignore patterns
// Converts gitignore patterns to glob patterns for file matching
export async function parseGitignore(dir: string): Promise<string[]> {
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

      if (!line || line.startsWith("#")) continue;

      let pattern = line;

      if (pattern.startsWith("!")) {
        continue;
      }

      if (pattern.endsWith("/")) {
        pattern = `${pattern.slice(0, -1)}/**`;
      }

      if (!pattern.startsWith("/") && !pattern.includes("/")) {
        pattern = `**/${pattern}`;
      }

      if (pattern.startsWith("/")) {
        pattern = pattern.slice(1);
      }

      gitignorePatterns.push(pattern);
    }
  } catch (error) {
    log.dim(`Note: Could not read .gitignore (${error})`);
  }

  return gitignorePatterns;
}

// Finds all files in the target directory, excluding patterns from .gitignore and built-in excludes
export async function findFiles(targetDir: string): Promise<string[]> {
  const gitignorePatterns: string[] = await parseGitignore(targetDir);
  const allExcludePatterns: string[] = [
    ...excludePatterns,
    ...gitignorePatterns,
  ];

  const glob = new Glob("**/*");
  const files: string[] = [];

  for await (const file of glob.scan(targetDir)) {
    const shouldExclude = allExcludePatterns.some((pattern: string) => {
      const excludeGlob = new Glob(pattern);
      return excludeGlob.match(file);
    });

    if (!shouldExclude) {
      const fullPath = join(targetDir, file);
      try {
        if (existsSync(fullPath) && statSync(fullPath).isFile()) {
          files.push(fullPath);
        }
      } catch {}
    }
  }

  return files;
}
