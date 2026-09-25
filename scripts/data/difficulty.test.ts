import { describe, expect, it } from "vitest";
import {
  assignBands,
  easeScores,
  percentileRank,
  similarNeighbors,
} from "./difficulty.ts";

describe("percentileRank", () => {
  it("順位を 0〜1 にし、同値は平均順位にする", () => {
    expect(percentileRank([30, 10, 20, 20])).toEqual([1, 0, 0.5, 0.5]);
  });
});

describe("assignBands", () => {
  it("易しい順に比率どおり区切る", () => {
    const scores = [0.1, 0.9, 0.5, 0.7, 0.3, 0.2, 0.8, 0.4, 0.6, 0.0];
    const bands = [
      { name: "a", fraction: 0.2 },
      { name: "b", fraction: 0.3 },
      { name: "c", fraction: 0.5 },
    ];
    const r = assignBands(scores, bands);
    expect(r.filter((b) => b === 0)).toHaveLength(2);
    expect(r.filter((b) => b === 1)).toHaveLength(3);
    expect(r[1]).toBe(0); // 0.9
    expect(r[9]).toBe(2); // 0.0
  });
});

describe("easeScores", () => {
  const base = {
    sitelinks: 0,
    inhabited: false,
    shapeUniqueness: 0,
    similarNeighbors: 0,
  };
  it("面積だけの重みなら大きい島ほど易しい", () => {
    const w = { area: 1, fame: 0, inhabited: 0, shape: 0, density: 0 };
    const s = easeScores(
      [
        { ...base, areaKm2: 1 },
        { ...base, areaKm2: 100 },
      ],
      w,
    );
    expect(s[1]).toBeGreaterThan(s[0]);
  });
  it("近くに似た島が多いほど難しい", () => {
    const w = { area: 0, fame: 0, inhabited: 0, shape: 0, density: 1 };
    const s = easeScores(
      [
        { ...base, areaKm2: 1, similarNeighbors: 5 },
        { ...base, areaKm2: 1, similarNeighbors: 0 },
      ],
      w,
    );
    expect(s[1]).toBeGreaterThan(s[0]);
  });
});

describe("similarNeighbors", () => {
  it("半径内かつ面積が近い島だけ数える", () => {
    const r = similarNeighbors(
      [
        { center: [130, 33], areaKm2: 1 },
        { center: [130.1, 33], areaKm2: 2 }, // 約9km、面積比2倍 → 数える
        { center: [130.1, 33.01], areaKm2: 100 }, // 近いが面積が違う
        { center: [132, 33], areaKm2: 1 }, // 遠い
      ],
      30,
      0.5,
    );
    expect(r).toEqual([1, 1, 0, 0]);
  });
});
