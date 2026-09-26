import { describe, expect, it } from "vitest";
import type { Island } from "../../scripts/data/pipeline.ts";
import {
  levenshtein,
  nameSimilarity,
  pickChoices,
  stripSuffix,
} from "./choices.ts";
import { pickQuestions } from "./game.ts";
import { questionBounds } from "./zoom.ts";

/** 固定シードの乱数 */
function rng(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

let n = 0;
function island(p: Partial<Island>): Island {
  n++;
  return {
    id: `w${n}`,
    name: `島${n}`,
    areaKm2: 1,
    bbox: [135, 35, 135.01, 35.01],
    center: [135.005, 35.005],
    sitelinks: 0,
    shapeUniqueness: 0,
    similarNeighbors: 0,
    score: 0,
    band: 0,
    bandByArea: 0,
    ...p,
  };
}

describe("pickQuestions", () => {
  it("指定した帯から重複なしで選ぶ", () => {
    const pool = [
      ...Array.from({ length: 30 }, () => island({ band: 0 })),
      ...Array.from({ length: 30 }, () => island({ band: 1 })),
    ];
    const qs = pickQuestions(pool, 1, 10, rng());
    expect(qs).toHaveLength(10);
    expect(new Set(qs.map((q) => q.id)).size).toBe(10);
    expect(qs.every((q) => q.band === 1)).toBe(true);
  });
});

describe("名前の比較", () => {
  it("接尾辞を除く", () => {
    expect(stripSuffix("佐渡島")).toBe("佐渡");
    expect(stripSuffix("さどがしま")).toBe("さどが");
    expect(stripSuffix("島")).toBe("島");
  });
  it("編集距離", () => {
    expect(levenshtein("くろしま", "くるしま")).toBe(1);
  });
  it("共通の漢字や読みが近いほど似ている", () => {
    const kuro = { name: "黒島", yomi: "くろしま" };
    expect(nameSimilarity(kuro, { name: "黒髪島" })).toBeGreaterThan(
      nameSimilarity(kuro, { name: "青島" }),
    );
    expect(
      nameSimilarity(kuro, { name: "久留島", yomi: "くるしま" }),
    ).toBeGreaterThanOrEqual(0.5);
  });
});

describe("pickChoices", () => {
  const answer = island({
    name: "大島",
    pref: "東京都",
    center: [139.4, 34.7],
  });
  const pool = [
    answer,
    island({ name: "大島", pref: "山口県" }), // 同名 → 入れない
    island({ name: "利島", center: [139.28, 34.52] }),
    island({ name: "新島", center: [139.26, 34.37] }),
    island({ name: "新島", center: [139.27, 34.38] }), // 選択肢内で名前が重複しない
    island({ name: "大津島", center: [131.7, 34.1] }),
    island({ name: "神津島", center: [139.15, 34.2] }),
    island({ name: "三宅島", center: [139.5, 34.08] }),
    ...Array.from({ length: 20 }, () => island({ band: 0, center: [130, 30] })),
  ];

  it("正解を含む4つで、名前が重複せず、正解と同名の島を含まない", () => {
    for (let seed = 1; seed < 50; seed++) {
      const cs = pickChoices(answer, pool, rng(seed));
      expect(cs).toHaveLength(4);
      expect(cs).toContain(answer);
      expect(new Set(cs.map((c) => c.name)).size).toBe(4);
      expect(cs.filter((c) => c.name === "大島")).toEqual([answer]);
    }
  });

  it("候補が少なくても落ちない", () => {
    expect(pickChoices(answer, [answer, pool[2]], rng())).toHaveLength(2);
  });

  it("不正解は正解と同じか易しい帯の島だけ", () => {
    const hard = island({ name: "難島", band: 3, center: [139.4, 34.7] });
    const pool2 = [hard, island({ name: "岩", band: 3 }), ...pool];
    const easy = island({ name: "易島", band: 0, center: [139.4, 34.7] });
    for (let seed = 1; seed < 20; seed++) {
      expect(pickChoices(easy, [easy, ...pool2], rng(seed)).every((c) => c.band === 0)).toBe(true);
    }
  });
});

describe("questionBounds", () => {
  it("島を含み、最低限の文脈（40km）を確保する", () => {
    const bbox: [number, number, number, number] = [
      139.36, 34.67, 139.44, 34.73,
    ];
    for (let seed = 1; seed < 50; seed++) {
      const [[w, s], [e, nn]] = questionBounds(bbox, rng(seed));
      expect(w).toBeLessThanOrEqual(bbox[0]);
      expect(s).toBeLessThanOrEqual(bbox[1]);
      expect(e).toBeGreaterThanOrEqual(bbox[2]);
      expect(nn).toBeGreaterThanOrEqual(bbox[3]);
      expect((nn - s) * 111.32).toBeGreaterThanOrEqual(40);
    }
  });
});
