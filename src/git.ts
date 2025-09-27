import { relative } from "node:path";

// Extracts author information from a file using git blame
// Returns either an array of all authors or a count for a specific user
export async function getAuthorsFromFile(
  filepath: string,
  targetDir: string,
  filterUser?: string,
): Promise<string[] | number> {
  try {
    const relativePath = relative(targetDir, filepath);

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
