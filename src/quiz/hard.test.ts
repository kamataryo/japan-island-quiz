import { describe, expect, it } from "vitest";
import { isHard } from "./hard.ts";

describe("isHard", () => {
  it("5回答以上で正答率10%以下なら難問", () => {
    expect(isHard({ answers: 5, correct: 0 })).toBe(true);
    expect(isHard({ answers: 10, correct: 1 })).toBe(true);
  });

  it("正答率が10%を超えるなら難問ではない", () => {
    expect(isHard({ answers: 9, correct: 1 })).toBe(false);
    expect(isHard({ answers: 5, correct: 1 })).toBe(false);
  });

  it("回答が少ない・ないときは出さない", () => {
    expect(isHard({ answers: 4, correct: 0 })).toBe(false);
    expect(isHard({ answers: 0, correct: 0 })).toBe(false);
    expect(isHard(undefined)).toBe(false);
  });
});
