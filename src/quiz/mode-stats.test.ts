import { describe, expect, it } from "vitest";
import { gaugeFilled, MIN_PLAYS, modeRate } from "./mode-stats.ts";

describe("modeRate", () => {
  it("正解数の合計 ÷ 出題数の合計", () => {
    expect(
      modeRate({ mode: "ふつう", n: MIN_PLAYS, score: 192, questions: 300 }),
    ).toBeCloseTo(0.64);
  });

  it("プレイ数が足りない・集計がないときは出さない", () => {
    expect(
      modeRate({ mode: "ふつう", n: MIN_PLAYS - 1, score: 0, questions: 0 }),
    ).toBeUndefined();
    expect(modeRate(undefined)).toBeUndefined();
  });
});

describe("gaugeFilled", () => {
  it("5マスに丸める", () => {
    expect(gaugeFilled(0)).toBe(0);
    expect(gaugeFilled(0.23)).toBe(1);
    expect(gaugeFilled(0.64)).toBe(3);
    expect(gaugeFilled(0.82)).toBe(4);
    expect(gaugeFilled(1)).toBe(5);
  });
});
