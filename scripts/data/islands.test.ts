import { circle, polygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { islandAttributes, shapeUniqueness, toHiragana } from "./islands.ts";

describe("islandAttributes", () => {
  it("name:ja を優先し、カタカナの読みをひらがなにする", () => {
    const a = islandAttributes({
      name: "Sado",
      "name:ja": "佐渡島",
      "name:ja_kana": "サドガシマ",
      population: "51,492",
      wikidata: "Q273011",
    });
    expect(a).toMatchObject({
      name: "佐渡島",
      yomi: "さどがしま",
      population: 51492,
    });
  });
  it("名前がなければ undefined、不正な wikidata は捨てる", () => {
    expect(islandAttributes({ place: "islet" })).toBeUndefined();
    expect(
      islandAttributes({ name: "x", wikidata: "Q1 }" })?.wikidata,
    ).toBeUndefined();
  });
  it("toHiragana は長音記号を残す", () => {
    expect(toHiragana("ヴァーチャル")).toBe("ゔぁーちゃる");
  });
});

describe("shapeUniqueness", () => {
  it("円はほぼ 0、細長い島や入り組んだ島は大きい", () => {
    const round = shapeUniqueness(circle([135, 35], 1, { steps: 64 }));
    const bar = shapeUniqueness(
      polygon([
        [
          [135, 35],
          [135.2, 35],
          [135.2, 35.005],
          [135, 35.005],
          [135, 35],
        ],
      ]),
    );
    const lShape = shapeUniqueness(
      polygon([
        [
          [135, 35],
          [135.02, 35],
          [135.02, 35.002],
          [135.002, 35.002],
          [135.002, 35.02],
          [135, 35.02],
          [135, 35],
        ],
      ]),
    );
    expect(round).toBeLessThan(0.05);
    expect(bar).toBeGreaterThan(0.8);
    expect(lShape).toBeGreaterThan(0.5);
  });
});
