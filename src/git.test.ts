import { describe, expect, test } from "bun:test";
import { buildBlameArgs } from "./git.js";

describe("buildBlameArgs", () => {
  test.each([
    [0, ["git", "blame", "-w", "--line-porcelain", "src/file.ts"]],
    [1, ["git", "blame", "-w", "-M", "--line-porcelain", "src/file.ts"]],
    [2, ["git", "blame", "-w", "-M", "-C", "--line-porcelain", "src/file.ts"]],
    [
      3,
      [
        "git",
        "blame",
        "-w",
        "-M",
        "-C",
        "-C",
        "--line-porcelain",
        "src/file.ts",
      ],
    ],
    [
      4,
      [
        "git",
        "blame",
        "-w",
        "-M",
        "-C",
        "-C",
        "-C",
        "--line-porcelain",
        "src/file.ts",
      ],
    ],
  ] as const)("uses depth %i", (depth, expected) => {
    expect(buildBlameArgs("src/file.ts", depth)).toEqual(expected);
  });
});
