import config from "../../config/difficulty.json";
import regions from "../../config/regions.json";
import type { Island } from "../../scripts/data/pipeline.ts";
import { islandsIn } from "./game.ts";

/** 遊び方（難易度帯か地域）。questions から出題し、choices から選択肢を作る */
export type Mode = {
  name: string;
  questions: Island[];
  choices: Island[];
  weight?: (x: Island) => number;
  /** 地域モードの範囲 */
  polygon?: number[][];
};

/**
 * 地域モードは帯を混ぜて出すので、均等だと小さな岩ばかりになる。面積^0.25 で大きい島を出やすくする
 * （瀬戸内海で 1ゲームの内訳が おおよそ かんたん0.4・ふつう2.8・むずい4.7・おに2.0 問になる）
 */
const regionWeight = (x: Island) => x.areaKm2 ** 0.25;

export function buildModes(islands: Island[]): {
  bands: Mode[];
  areas: Mode[];
} {
  const bands: Mode[] = config.bands.map((b, i) => ({
    name: b.name,
    questions: islands.filter((x) => x.band === i),
    choices: islands,
  }));
  // 地域モードは難易度を問わず出題し、選択肢も地域内の島から作る
  // （外の島が混ざると、それだけで不正解と分かってしまうため）
  const areas: Mode[] = regions.map((r) => {
    const xs = islandsIn(islands, r.polygon);
    return {
      name: r.name,
      questions: xs,
      choices: xs,
      weight: regionWeight,
      polygon: r.polygon,
    };
  });
  return { bands, areas };
}
