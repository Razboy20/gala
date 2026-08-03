import { describe, expect, test } from "bun:test";
import {
  buildBlameArgs,
  getAuthorHistogram,
  parseAuthorHistogram,
} from "./git.js";

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

describe("parseAuthorHistogram", () => {
  test("counts porcelain author records without retaining a line array", () => {
    expect({
      ...parseAuthorHistogram(
        "author Ada Lovelace\nauthor-mail <ada@example.com>\nauthor Grace Hopper\nauthor Ada Lovelace\n",
      ),
    }).toEqual({ "Ada Lovelace": 2, "Grace Hopper": 1 });
  });

  test("ignores empty author records", () => {
    expect({ ...parseAuthorHistogram("author \nauthor Ada\n") }).toEqual({
      Ada: 1,
    });
  });

  test("counts names inherited from Object.prototype safely", () => {
    const histogram = parseAuthorHistogram(
      "author constructor\nauthor __proto__\nauthor constructor\n",
    );

    expect(Object.getPrototypeOf(histogram)).toBeNull();
    expect(histogram.constructor).toBe(2);
    expect(histogram.__proto__).toBe(1);
  });
});

describe("getAuthorHistogram", () => {
  test("returns null when blame exits unsuccessfully", async () => {
    expect(
      await getAuthorHistogram("missing.ts", import.meta.dir, 2),
    ).toBeNull();
  });
});
