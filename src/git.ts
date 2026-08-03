import { relative } from "node:path";

export type BlameDepth = 0 | 1 | 2 | 3 | 4;
export type AuthorHistogram = Record<string, number>;

export function createAuthorHistogram(): AuthorHistogram {
  return Object.create(null) as AuthorHistogram;
}

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

export function parseAuthorHistogram(output: string): AuthorHistogram {
  const histogram = createAuthorHistogram();

  for (const match of output.matchAll(/^author (.+)$/gm)) {
    const author = match[1];
    if (author?.trim()) {
      histogram[author] = (histogram[author] ?? 0) + 1;
    }
  }

  return histogram;
}

export async function getAuthorHistogram(
  filepath: string,
  targetDir: string,
  blameDepth: BlameDepth = 2,
): Promise<AuthorHistogram | null> {
  try {
    const relativePath = relative(targetDir, filepath);
    const proc = Bun.spawn(buildBlameArgs(relativePath, blameDepth), {
      cwd: targetDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, output] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    return exitCode === 0 ? parseAuthorHistogram(output) : null;
  } catch (_error) {
    return null;
  }
}
