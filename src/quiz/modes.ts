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
  /** 出題中・答え合わせで、島の凸包が画面の一定の割合を占めるまで寄せる（むずい・おにモード） */
  fill?: boolean;
};

/** この帯（むずい・おに）以上のモードは島に寄せる */
const FILL_FROM_BAND = 2;

export function buildModes(islands: Island[]): {
  bands: Mode[];
  areas: Mode[];
} {
  const counts = config.bands.map(
    (_, i) => islands.filter((x) => x.band === i).length,
  );
  // 選んだ帯を主に、それより易しい帯も mix の割合で混ぜる
  // （帯ごとの島数の差を打ち消すよう、割合を島数で割って1島あたりの重みにする）
  const bands: Mode[] = config.bands.map((b, i) => ({
    name: b.name,
    questions: islands.filter((x) => (b.mix[x.band] ?? 0) > 0),
    choices: islands,
    weight: (x) => b.mix[x.band] / counts[x.band],
    fill: i >= FILL_FROM_BAND,
  }));
  // 地域モードは難易度を問わず出題し、選択肢も地域内の島から作る
  // （外の島が混ざると、それだけで不正解と分かってしまうため）
  const areas: Mode[] = regions.map((r) => {
    const xs = islandsIn(islands, r.polygon);
    // 帯を混ぜて出すので、均等だと小さな岩ばかりになる。面積^weightExponent で大きい島を出やすくする
    // （地域ごとに島の大きさの分布が違うので指数も地域ごとに決める）
    const base = (x: Island) => x.areaKm2 ** r.weightExponent;
    // 「おに」は指数だけでは減らしきれないので、重みを縮めて出る割合を oniShare 以下にする
    const oni = config.bands.length - 1;
    const sum = (ys: Island[]) => ys.reduce((s, x) => s + base(x), 0);
    const oniW = sum(xs.filter((x) => x.band === oni));
    const restW = sum(xs.filter((x) => x.band !== oni));
    const k = Math.min(
      1,
      ((r.oniShare / (1 - r.oniShare)) * restW) / oniW || 1,
    );
    return {
      name: r.name,
      questions: xs,
      choices: xs,
      weight: (x) => base(x) * (x.band === oni ? k : 1),
      polygon: r.polygon,
    };
  });
  return { bands, areas };
}
