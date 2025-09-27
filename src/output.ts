import chalk from "chalk";
import Table from "cli-table3";
import { log } from "./logger.js";

// Displays per-file contributions for a specific user
export function displayUserContributions(
  userFileContributions: Record<string, number>,
  targetUser: string,
  _targetDir: string,
  filesCount: number,
): void {
  const sortedFiles: [string, number][] = Object.entries(
    userFileContributions,
  ).sort(([, a], [, b]) => b - a);

  log.header(`📝 ${targetUser}'s Contributions by File`);

  if (sortedFiles.length === 0) {
    log.warn(`No contributions found for user "${chalk.magenta(targetUser)}"`);
  } else {
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

    const displayFiles = sortedFiles.slice(0, 20);
    for (const [filepath, count] of displayFiles) {
      table.push([chalk.green(count.toLocaleString()), chalk.cyan(filepath)]);
    }

    console.log(`\n${table.toString()}`);

    if (sortedFiles.length > 20) {
      console.log(chalk.dim(`... and ${sortedFiles.length - 20} more files\n`));
    }
  }

  const totalUserLines = Object.values(userFileContributions).reduce(
    (sum, count) => sum + count,
    0,
  );

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
      chalk.green(`Total lines by ${targetUser}`),
      chalk.bold(totalUserLines.toLocaleString()),
    ],
    [
      chalk.blue("Files contributed to"),
      chalk.bold(sortedFiles.length.toString()),
    ],
    [chalk.gray("Files processed"), chalk.bold(filesCount.toString())],
  );

  console.log(chalk.bgBlue.white(" SUMMARY "));
  console.log(summaryTable.toString());
}

// Displays general author contributions across all files
export function displayGeneralContributions(
  allAuthors: string[],
  filesCount: number,
): void {
  const authorCounts: Record<string, number> = {};
  for (const author of allAuthors) {
    if (author.trim()) {
      authorCounts[author] = (authorCounts[author] || 0) + 1;
    }
  }

  const sortedAuthors: [string, number][] = Object.entries(authorCounts).sort(
    ([, a], [, b]) => b - a,
  );

  log.header("🏆 Author Contributions by Lines");

  if (sortedAuthors.length === 0) {
    log.warn("No authors found!");
  } else {
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

    const displayAuthors = sortedAuthors.slice(0, 20);
    displayAuthors.forEach(([author, count], i) => {
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

    console.log(`\n${table.toString()}`);

    if (sortedAuthors.length > 20) {
      console.log(
        chalk.dim(`... and ${sortedAuthors.length - 20} more authors\n`),
      );
    }
  }

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
    [chalk.gray("Files processed"), chalk.bold(filesCount.toString())],
  );

  console.log(chalk.bgGreen.white(" SUMMARY "));
  console.log(summaryTable.toString());
}
