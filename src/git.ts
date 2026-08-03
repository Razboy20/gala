import { relative } from "node:path";

export type BlameDepth = 0 | 1 | 2 | 3 | 4;

export function buildBlameArgs(
  relativePath: string,
  blameDepth: BlameDepth = 2,
): string[] {
  return [
    "git",
    "blame",
    "-w",
    ...(blameDepth > 0 ? ["-M"] : []),
    ...Array.from({ length: Math.max(blameDepth - 1, 0) }, () => "-C"),
    "--line-porcelain",
    relativePath,
  ];
}

// Extracts author information from a file using git blame
// Returns either an array of all authors or a count for a specific user
export async function getAuthorsFromFile(
  filepath: string,
  targetDir: string,
  filterUser?: string,
  blameDepth: BlameDepth = 2,
): Promise<string[] | number> {
  try {
    const relativePath = relative(targetDir, filepath);

    const proc = Bun.spawn(buildBlameArgs(relativePath, blameDepth), {
      cwd: targetDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const authors: string[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      if (line.startsWith("author ")) {
        authors.push(line.substring(7));
      }
    }

    if (filterUser) {
      return authors.filter((author) => author === filterUser).length;
    }

    return authors;
  } catch (_error) {
    return filterUser ? 0 : [];
  }
}
