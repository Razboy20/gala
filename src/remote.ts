import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { log } from "./logger.js";

// Options for cloning remote repositories
export interface RemoteOptions {
  branch?: string;
  tag?: string;
  keepClone?: boolean;
}

// Checks if the input string is a remote git repository URL
export function isRemoteUrl(input: string): boolean {
  const remotePatterns = [
    /^https?:\/\//,
    /^git@/,
    /^ssh:\/\//,
    /^git:\/\//,
    /\.git$/,
  ];

  return remotePatterns.some((pattern) => pattern.test(input));
}

// Generates a unique temporary directory name for cloning repositories
export function generateTempDir(repoUrl: string): string {
  const repoName =
    repoUrl
      .split("/")
      .pop()
      ?.replace(/\.git$/, "")
      ?.replace(/[^a-zA-Z0-9-_]/g, "_") || "repo";

  const timestamp = Date.now();
  return join(tmpdir(), `gala_${repoName}_${timestamp}`);
}

// Clones a remote repository to a temporary directory
export async function cloneRepository(
  repoUrl: string,
  options: RemoteOptions = {},
): Promise<string> {
  const tempDir = generateTempDir(repoUrl);

  log.info(`Cloning repository: ${chalk.cyan(repoUrl)}`);
  log.info(`Target directory: ${chalk.gray(tempDir)}`);

  const args = ["clone"];

  if (options.branch) {
    args.push("--branch", options.branch);
  }

  if (options.tag) {
    args.push("--branch", options.tag);
  }

  args.push(repoUrl, tempDir);

  try {
    const proc = Bun.spawn(["git", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    await proc.exited;

    if (proc.exitCode !== 0) {
      throw new Error(`Git clone failed: ${stderr}`);
    }

    if (!existsSync(join(tempDir, ".git"))) {
      throw new Error(
        "Cloned directory does not contain a valid git repository",
      );
    }

    log.success(`Repository cloned successfully`);

    if (options.branch) {
      log.info(`Using branch: ${chalk.magenta(options.branch)}`);
    }
    if (options.tag) {
      log.info(`Using tag: ${chalk.magenta(options.tag)}`);
    }

    return tempDir;
  } catch (error) {
    if (existsSync(tempDir)) {
      cleanupTempDir(tempDir);
    }
    throw error;
  }
}

// Removes temporary directory and all its contents
export function cleanupTempDir(tempDir: string): void {
  try {
    if (existsSync(tempDir)) {
      log.info(`Cleaning up temporary directory: ${chalk.gray(tempDir)}`);
      rmSync(tempDir, { recursive: true, force: true });
      log.success("Cleanup completed");
    }
  } catch (error) {
    log.warn(`Failed to cleanup temporary directory: ${error}`);
  }
}

// Sets up signal handlers to cleanup temporary directories on process exit
export function setupCleanupHandler(
  tempDir: string,
  keepClone: boolean = false,
): void {
  const cleanup = () => {
    if (!keepClone) {
      log.info("\nReceived interrupt signal, cleaning up...");
      cleanupTempDir(tempDir);
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  if (!keepClone) {
    process.on("exit", () => cleanupTempDir(tempDir));
  }
}
