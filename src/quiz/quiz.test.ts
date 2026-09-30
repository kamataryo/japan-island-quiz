import { describe, expect, it } from "vitest";
import type { Island } from "../../scripts/data/pipeline.ts";
import {
  levenshtein,
  nameSimilarity,
  pickChoices,
  sameName,
  stripSuffix,
} from "./choices.ts";
import { inPolygon, islandsIn, pickQuestions } from "./game.ts";
import { fillZoom, questionBounds, questionZoom } from "./zoom.ts";

/** 固定シードの乱数。小さいシードのままだと最初の値がどれも 0 に近くなるので、散らしてから使う */
function rng(seed = 1) {
  seed = (seed * 1_000_003) % 2147483647;
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
    hullKm2: 1,
    bbox: [135, 35, 135.01, 35.01],
    center: [135.005, 35.005],
    sitelinks: 0,
    shapeUniqueness: 0,
    similarNeighbors: 0,
    score: 0,
    band: 0,
    bandByArea: 0,
    prefs: [],
    cities: [],
    ...p,
  };
}

describe("pickQuestions", () => {
  const pool = Array.from({ length: 30 }, (_, i) =>
    island({ areaKm2: i < 3 ? 1000 : 0.001 }),
  );
  it("重複なしで n 問選ぶ", () => {
    const qs = pickQuestions(pool, 10, rng());
    expect(new Set(qs.map((q) => q.id)).size).toBe(10);
  });
  it("重みの大きい島ほど選ばれやすい", () => {
    let big = 0;
    for (let seed = 1; seed < 50; seed++) {
      const qs = pickQuestions(pool, 3, rng(seed), (x) => x.areaKm2 ** 0.25);
      big += qs.filter((q) => q.areaKm2 === 1000).length;
    }
    // 均等なら 147 個中 約15個。重みは大きい島 5.6・小さい島 0.18 で、合計では 3島で約8割を占める
    expect(big).toBeGreaterThan(60);
  });
});

describe("地域", () => {
  // へこんだ形（L 字）でも判定できること
  const L = [
    [0, 0],
    [2, 0],
    [2, 1],
    [1, 1],
    [1, 2],
    [0, 2],
  ];
  it("多角形の内外を判定する", () => {
    expect(inPolygon([0.5, 0.5], L)).toBe(true);
    expect(inPolygon([0.5, 1.5], L)).toBe(true);
    expect(inPolygon([1.5, 1.5], L)).toBe(false);
    expect(inPolygon([3, 0.5], L)).toBe(false);
  });
  it("代表点が地域に入る島だけを選ぶ", () => {
    const a = island({ center: [0.5, 0.5] });
    const b = island({ center: [1.5, 1.5] });
    expect(islandsIn([a, b], L)).toEqual([a]);
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
  it("表記ゆれやかな書きの同じ読みは同名とみなす", () => {
    const same = (a: string, b: string, ya?: string, yb?: string) =>
      sameName({ name: a, yomi: ya }, { name: b, yomi: yb });
    expect(same("沖ノ島", "沖之島")).toBe(true);
    expect(same("沖の島", "沖ノ島")).toBe(true);
    expect(same("竹ケ島", "竹ヶ島")).toBe(true);
    expect(same("中嶋", "中島")).toBe(true);
    expect(same("龍宮島", "竜宮島")).toBe(true);
    expect(same("三つ子島", "三ツ子島")).toBe(true);
    expect(same("タコ島", "蛸島", "たこしま", "たこじま")).toBe(true);
    expect(same("猪ノ子島", "猪子島", "いのこしま", "いのこしま")).toBe(true);
    // 漢字だけなら読みが同じでも見分けられる
    expect(same("高島", "鷹島", "たかしま", "たかしま")).toBe(false);
    expect(same("沖ノ島", "沖ノ小島")).toBe(false);
  });
});

describe("pickChoices", () => {
  const answer = island({
    name: "大島",
    prefs: ["東京都"],
    center: [139.4, 34.7],
  });
  const pool = [
    answer,
    island({ name: "大島", prefs: ["山口県"] }), // 同名 → 入れない
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

  it("表記ゆれの同名の島を入れない", () => {
    const oki = island({ name: "沖ノ島", center: [130, 33] });
    const pool2 = [
      oki,
      island({ name: "沖之島", center: [130, 33.01] }),
      island({ name: "沖の島", center: [130, 33.02] }),
      island({ name: "沖ノ小島", center: [130.01, 33.02] }),
      island({ name: "沖野小島", center: [130.02, 33.02] }),
      ...Array.from({ length: 5 }, () => island({ center: [130.1, 33] })),
    ];
    for (let seed = 1; seed < 50; seed++) {
      const cs = pickChoices(oki, pool2, rng(seed));
      expect(cs).toHaveLength(4);
      for (const a of cs)
        for (const b of cs) if (a !== b) expect(sameName(a, b)).toBe(false);
    }
  });

  it("名前の似た組に正解が入るとは限らない", () => {
    // 正解とだけ名前が似た島、正解の近くの島とだけ名前が似た島を用意する
    const ans = island({ name: "黒島", center: [130, 33] });
    const pool2 = [
      ans,
      island({ name: "黒髪島", center: [135, 35] }),
      island({ name: "白石島", center: [130.01, 33] }),
      island({ name: "白木島", center: [135, 35] }),
      // 互いに似ていない島（「岩」は接尾辞として除かないので「甲岩」などだと互いに似てしまう）
      ...Array.from({ length: 10 }, (_, i) =>
        island({ name: `${"甲乙丙丁戊己庚辛壬癸"[i]}島`, center: [131, 34] }),
      ),
    ];
    const kinds = { answer: 0, dummy: 0 };
    for (let seed = 1; seed < 400; seed++) {
      const names = pickChoices(ans, pool2, rng(seed)).map((c) => c.name);
      if (names.includes("黒髪島")) kinds.answer++;
      if (names.includes("白石島") && names.includes("白木島")) kinds.dummy++;
    }
    expect(kinds.dummy).toBeGreaterThan(kinds.answer * 0.5);
  });

  it("候補が少なくても落ちない", () => {
    expect(pickChoices(answer, [answer, pool[2]], rng())).toHaveLength(2);
  });

  it("不正解は正解と同じか易しい帯の島だけ", () => {
    const hard = island({ name: "難島", band: 3, center: [139.4, 34.7] });
    const pool2 = [hard, island({ name: "岩", band: 3 }), ...pool];
    const easy = island({ name: "易島", band: 0, center: [139.4, 34.7] });
    for (let seed = 1; seed < 20; seed++) {
      expect(
        pickChoices(easy, [easy, ...pool2], rng(seed)).every(
          (c) => c.band === 0,
        ),
      ).toBe(true);
    }
  });
});

describe("pickChoices（易しい帯の候補が足りないとき）", () => {
  it("難しい帯の島で埋める", () => {
    const easy = island({ name: "易島", band: 0 });
    const pool = [
      easy,
      ...Array.from({ length: 5 }, () => island({ band: 3 })),
    ];
    expect(pickChoices(easy, pool, rng())).toHaveLength(4);
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

describe("questionZoom", () => {
  it("島が2倍の大きさなら1段引き、マーカーがちょうど消える", () => {
    const z = questionZoom([-0.01, -0.01, 0.01, 0.01], 16);
    expect(questionZoom([-0.02, -0.02, 0.02, 0.02], 16)).toBeCloseTo(z - 1, 3);
    // 赤道付近で外接円の半径は 0.01° の √2 倍。ズーム z で 16px を少し超える
    const r = 512 * 2 ** z * Math.hypot(0.01 / 360, 0.01 / 360);
    expect(r).toBeGreaterThan(16);
    expect(r).toBeLessThan(17);
  });
});

describe("fillZoom", () => {
  it("面積が4倍なら1段引き、赤道で1km²が画面の1/3を占める", () => {
    const z = fillZoom(1, 0, 600 * 400, 1 / 3);
    expect(fillZoom(4, 0, 600 * 400, 1 / 3)).toBeCloseTo(z - 1, 6);
    const mPerPx = 40_075_016.686 / (512 * 2 ** z);
    expect(1e6 / mPerPx ** 2 / (600 * 400)).toBeCloseTo(1 / 3, 6);
  });
});
