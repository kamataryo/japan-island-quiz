import { distance } from "@turf/turf";

export type Weights = {
  area: number;
  fame: number;
  inhabited: number;
  shape: number;
  density: number;
};
export type Band = { name: string; fraction: number };
export type DifficultyConfig = {
  weights: Weights;
  bands: Band[];
  density: { radiusKm: number; log10AreaTolerance: number };
};

export type Metrics = {
  areaKm2: number;
  sitelinks: number;
  inhabited: boolean;
  /** 0 = 丸くて特徴がない, 1 に近いほど特徴的な形 */
  shapeUniqueness: number;
  /** 近くにある似たサイズの島の数 */
  similarNeighbors: number;
};

/** 各値の順位を 0〜1 に正規化する（同値は平均順位） */
export function percentileRank(values: number[]): number[] {
  const order = values
    .map((v, i) => [v, i] as const)
    .sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const r = order.length > 1 ? (i + j) / 2 / (order.length - 1) : 0.5;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}

/** 易しさスコア（0〜1、大きいほど易しい）。各指標は順位で正規化してから重み付き平均する */
export function easeScores(ms: Metrics[], w: Weights): number[] {
  const area = percentileRank(ms.map((m) => Math.log(m.areaKm2)));
  const fame = percentileRank(ms.map((m) => m.sitelinks));
  const shape = percentileRank(ms.map((m) => m.shapeUniqueness));
  const density = percentileRank(ms.map((m) => m.similarNeighbors));
  const total = w.area + w.fame + w.inhabited + w.shape + w.density;
  return ms.map(
    (m, i) =>
      (w.area * area[i] +
        w.fame * fame[i] +
        w.inhabited * (m.inhabited ? 1 : 0) +
        w.shape * shape[i] +
        w.density * (1 - density[i])) /
      total,
  );
}

/** 易しい順に並べ、bands の fraction の比率で区切る。戻り値は band の index（0 がいちばん易しい） */
export function assignBands(scores: number[], bands: Band[]): number[] {
  const n = scores.length;
  const total = bands.reduce((s, b) => s + b.fraction, 0);
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const result = new Array<number>(n);
  let b = 0;
  let cum = bands[0].fraction;
  order.forEach((idx, rank) => {
    while (b < bands.length - 1 && rank >= Math.round((cum / total) * n)) {
      b++;
      cum += bands[b].fraction;
    }
    result[idx] = b;
  });
  return result;
}

// ponytail: 全ペア O(n²)。島が数万を超えて遅くなったらグリッド索引にする
export function similarNeighbors(
  items: { center: [number, number]; areaKm2: number }[],
  radiusKm: number,
  log10Tolerance: number,
): number[] {
  const counts = new Array<number>(items.length).fill(0);
  const degLat = radiusKm / 111;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (Math.abs(a.center[1] - b.center[1]) > degLat) continue;
      if (Math.abs(Math.log10(a.areaKm2 / b.areaKm2)) > log10Tolerance)
        continue;
      if (distance(a.center, b.center) > radiusKm) continue;
      counts[i]++;
      counts[j]++;
    }
  }
  return counts;
}
