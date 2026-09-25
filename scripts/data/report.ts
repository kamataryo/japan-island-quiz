/** 目視確認用のレポート（Markdown）を書き出す */
import { writeFileSync } from "node:fs";
import type { DifficultyConfig } from "./difficulty.ts";
import type { Dropped, Island } from "./pipeline.ts";

const SAMPLES_PER_BAND = 15;

/** 実行ごとにサンプルが変わらないよう固定シードの乱数を使う */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OSM_TYPES: Record<string, string> = {
  n: "node",
  w: "way",
  r: "relation",
};
const osmUrl = (id: string) =>
  `https://www.openstreetmap.org/${OSM_TYPES[id[0]]}/${id.slice(1)}`;
const link = (id: string) => `[${id}](${osmUrl(id)})`;
const km2 = (v: number) => (v >= 1 ? v.toFixed(1) : v.toPrecision(2));

function table(
  header: string[],
  rows: (string | number | undefined)[][],
): string {
  return [
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map(
      (r) =>
        `| ${r.map((c) => String(c ?? "").replaceAll("|", "\\|")).join(" | ")} |`,
    ),
  ].join("\n");
}

export function writeReport(
  path: string,
  islands: Island[],
  dropped: Dropped[],
  meta: {
    osmTimestamp: string;
    generatedAt: string;
    counts: Record<string, number>;
  },
  config: DifficultyConfig,
) {
  const names = config.bands.map((b) => b.name);
  const rand = mulberry32(1);
  const out: string[] = [];
  const p = (s: string) => out.push(s, "");

  p("# 島データ レポート");
  p(`- OSM データ時点: ${meta.osmTimestamp}\n- 生成: ${meta.generatedAt}`);
  p(table(["項目", "件数"], Object.entries(meta.counts)));

  p("## 面積の分布");
  const buckets = [
    0.0001,
    0.001,
    0.01,
    0.1,
    1,
    10,
    100,
    1000,
    Number.POSITIVE_INFINITY,
  ];
  p(
    table(
      ["面積 (km²)", "件数"],
      buckets.map((hi, i) => [
        `${i === 0 ? 0 : buckets[i - 1]} 〜 ${hi}`,
        islands.filter(
          (x) => x.areaKm2 < hi && (i === 0 || x.areaKm2 >= buckets[i - 1]),
        ).length,
      ]),
    ),
  );

  p("## 難易度帯");
  p(`重み: \`${JSON.stringify(config.weights)}\``);
  const range = (xs: Island[]) =>
    xs.length
      ? `${km2(Math.min(...xs.map((x) => x.areaKm2)))} 〜 ${km2(Math.max(...xs.map((x) => x.areaKm2)))}`
      : "";
  p(
    table(
      ["帯", "件数", "面積 (合成スコア)", "面積 (面積のみ)"],
      names.map((n, b) => {
        const byScore = islands.filter((x) => x.band === b);
        return [
          n,
          byScore.length,
          range(byScore),
          range(islands.filter((x) => x.bandByArea === b)),
        ];
      }),
    ),
  );

  p("### 面積のみ（行）と合成スコア（列）の比較");
  p(
    table(
      ["面積のみ ＼ 合成", ...names],
      names.map((n, a) => [
        n,
        ...names.map(
          (_, b) =>
            islands.filter((x) => x.bandByArea === a && x.band === b).length,
        ),
      ]),
    ),
  );

  const header = [
    "名前",
    "読み",
    "都道府県",
    "面積 km²",
    "sitelinks",
    "人口",
    "形",
    "近傍",
    "スコア",
    "面積のみ",
    "OSM",
  ];
  const row = (x: Island) => [
    x.name,
    x.yomi,
    x.pref,
    km2(x.areaKm2),
    x.sitelinks,
    x.population,
    x.shapeUniqueness,
    x.similarNeighbors,
    x.score,
    names[x.bandByArea],
    link(x.id),
  ];

  p("## 帯ごとのサンプル（合成スコア）");
  names.forEach((n, b) => {
    const xs = islands.filter((x) => x.band === b);
    const sample = xs
      .map((x) => [rand(), x] as const)
      .sort((a, c) => a[0] - c[0])
      .slice(0, SAMPLES_PER_BAND)
      .map(([, x]) => x)
      .sort((a, c) => c.score - a.score);
    p(`### ${n}（${xs.length}件中 ${sample.length}件）`);
    p(table(header, sample.map(row)));
  });

  p("## 面積のみと合成スコアで2段階以上ずれた島（sitelinks 順、上位30）");
  p(
    table(
      header,
      islands
        .filter((x) => Math.abs(x.band - x.bandByArea) >= 2)
        .sort((a, c) => c.sitelinks - a.sitelinks)
        .slice(0, 30)
        .map(row),
    ),
  );

  p("## 同名の島（上位20）");
  const byName = new Map<string, Island[]>();
  for (const x of islands)
    byName.set(x.name, [...(byName.get(x.name) ?? []), x]);
  p(
    table(
      ["名前", "件数", "都道府県"],
      [...byName]
        .filter(([, xs]) => xs.length > 1)
        .sort((a, c) => c[1].length - a[1].length)
        .slice(0, 20)
        .map(([n, xs]) => [
          n,
          xs.length,
          [...new Set(xs.map((x) => x.pref ?? "(なし)"))].join("、"),
        ]),
    ),
  );

  p("## 都道府県ごとの件数");
  const byPref = new Map<string, number>();
  for (const x of islands)
    byPref.set(x.pref ?? "(なし)", (byPref.get(x.pref ?? "(なし)") ?? 0) + 1);
  p(
    table(
      ["都道府県", "件数"],
      [...byPref].sort((a, c) => c[1] - a[1]),
    ),
  );

  const noPref = islands.filter((x) => !x.pref);
  p(`## 都道府県が付かなかった島（${noPref.length}件、先頭50件）`);
  p(table(header, noPref.slice(0, 50).map(row)));

  p("## 除外した島");
  const group = (r: string) => r.replace(/（.*$/, "");
  for (const g of new Set(dropped.map((d) => group(d.reason)))) {
    const ds = dropped.filter((d) => group(d.reason) === g);
    p(`### ${g}（${ds.length}件、先頭10件）`);
    p(
      table(
        ["名前", "理由", "OSM"],
        ds.slice(0, 10).map((d) => [d.name, d.reason, link(d.id)]),
      ),
    );
  }

  writeFileSync(path, out.join("\n"));
}
