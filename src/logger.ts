import chalk from "chalk";

// Helper functions for styled output
export const log = {
  info: (msg: string) => console.log(`${chalk.blue("ℹ")} ${msg}`),
  success: (msg: string) => console.log(`${chalk.green("✓")} ${msg}`),
  warn: (msg: string) => console.log(`${chalk.yellow("⚠")} ${msg}`),
  error: (msg: string) => console.log(`${chalk.red("✗")} ${msg}`),
  header: (msg: string) => console.log(`\n${chalk.bold.cyan(msg)}`),
  dim: (msg: string) => console.log(chalk.dim(msg)),
};

// Progress bar function
export function createProgressBar(
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
