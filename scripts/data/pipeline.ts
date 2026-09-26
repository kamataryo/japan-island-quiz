/**
 * 島データ生成パイプライン。`pnpm data` で実行する。
 * 各段階の成果物は data/cache/ にキャッシュされ、あれば再利用する（やり直すときはファイルを消す）。
 * 必要な CLI: osmium, ogr2ogr (GDAL), tippecanoe
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import {
  area,
  bbox,
  booleanIntersects,
  booleanPointInPolygon,
  featureCollection,
  intersect,
  pointOnFeature,
  simplify,
} from "@turf/turf";
import type { BBox, Feature, MultiPolygon, Polygon } from "geojson";
import {
  assignBands,
  type DifficultyConfig,
  easeScores,
  similarNeighbors,
} from "./difficulty.ts";
import { islandAttributes, shapeUniqueness, type Tags } from "./islands.ts";
import { writeReport } from "./report.ts";

const CACHE = "data/cache";
const OUT = "public/data";
const UA =
  "japan-island-quiz/0.1 (https://github.com/kamataryo/japan-island-quiz)";
const PBF_LATEST = "https://download.geofabrik.de/asia/japan-latest.osm.pbf";
const LAND_URL =
  "https://osmdata.openstreetmap.de/download/land-polygons-complete-4326.zip";
/** 日本の島（沖ノ鳥島〜択捉島、与那国島〜南鳥島）と周辺の文脈が入る範囲 */
const CLIP_BBOX = [120, 19.5, 156, 50] as const;
const OSMIUM_FILTER = [
  "nwr/place=island,islet",
  "a/natural=water",
  "r/admin_level=4",
  "r/admin_level=7",
];
/** これより大きい陸地ポリゴンは本土扱い（node の島の形状に使わない）。択捉島 3,167km² より十分大きい */
const MAINLAND_KM2 = 10_000;
/** 出題対象外（大きすぎて簡単） */
const EXCLUDED_NAMES = new Set(["本州", "北海道", "九州", "四国"]);
/** これより小さい島（約30m四方未満の岩）は画面で見分けられないので出題対象外 */
const MIN_AREA_KM2 = 0.001;
/**
 * 北方領土・竹島・尖閣諸島の範囲。OSM では実効支配側の行政区域に入っていることがあるので、
 * ここにある name:ja 付きの島は国外の行政区域内でも残す（都道府県は付けない）。
 * ただし Geofabrik の日本抽出には北方領土と竹島（島根県）が含まれないため、現状入るのは尖閣諸島だけ
 */
const DISPUTED_BBOXES: BBox[] = [
  [145.4, 43.2, 148.9, 45.6],
  [131.8, 37.2, 131.95, 37.3],
  [123.4, 25.6, 124.7, 26.0],
];
const PREFECTURES = new Set(
  (
    "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 " +
    "新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 " +
    "奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 " +
    "熊本県 大分県 宮崎県 鹿児島県 沖縄県"
  ).split(" "),
);
/** これより小さい水域（ため池など）はタイルに入れない。PMTiles を Workers の上限 25MiB 未満に収めるためでもある */
const WATER_MIN_KM2 = 0.05;

/**
 * 水域を表示し始めるズーム。画面上で一辺がおよそ 4px になってから出す
 * （--no-tiny-polygon-reduction で極小の島を残しているため、引いた地図で小さな池が点々と残って見えるのを防ぐ）
 */
function waterMinZoom(km2: number): number {
  const side = Math.sqrt(km2) * 1000; // m
  // 日本付近（北緯35度）で、ズーム z の 1px ≒ 64,000 / 2^z m
  return Math.max(3, Math.ceil(Math.log2((4 * 64_000) / side)));
}

type Area = Feature<Polygon | MultiPolygon>;

export type Island = {
  /** OSM の型の頭文字 + ID。n は node に対応付けた陸地ポリゴンを形状に使っている */
  id: string;
  name: string;
  nameJa?: string;
  nameEn?: string;
  yomi?: string;
  wikidata?: string;
  /** 日本語版 Wikipedia の記事名（記事があるときだけ） */
  wikipedia?: string;
  /** 島と重なる都道府県・市区町村。県境・市町村境の島は複数になり、重なる面積の大きい順に並ぶ */
  prefs: string[];
  cities: string[];
  population?: number;
  areaKm2: number;
  bbox: BBox;
  /** 島の上にあることが保証された代表点 */
  center: [number, number];
  sitelinks: number;
  shapeUniqueness: number;
  similarNeighbors: number;
  score: number;
  band: number;
  bandByArea: number;
};

export type Dropped = { id: string; name?: string; reason: string };

// ---- 取得 ----

type Source = {
  url: string;
  resolvedUrl: string;
  lastModified: string | null;
  fetchedAt: string;
};

async function download(url: string, dest: string): Promise<Source> {
  console.log(`download ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(
    Readable.fromWeb(res.body as ReadableStream),
    createWriteStream(`${dest}.tmp`),
  );
  renameSync(`${dest}.tmp`, dest);
  return {
    url,
    resolvedUrl: res.url,
    lastModified: res.headers.get("last-modified"),
    fetchedAt: new Date().toISOString(),
  };
}

const SOURCES = `${CACHE}/sources.json`;

function readSources(): Record<string, Source> {
  return existsSync(SOURCES) ? JSON.parse(readFileSync(SOURCES, "utf8")) : {};
}

/** 取得済みなら記録を返し、なければダウンロードする */
async function ensureSource(
  key: string,
  url: string,
  dest: string,
): Promise<Source> {
  const sources = readSources();
  if (!existsSync(dest) || sources[key]?.url !== url) {
    sources[key] = await download(url, dest);
    writeFileSync(SOURCES, JSON.stringify(sources, null, 2));
  }
  return sources[key];
}

/**
 * japan-latest は日付付きファイルへリダイレクトされるので、その URL に固定する。
 * 取得済みの PBF があれば、新しい日付のファイルが出ていてもそれを使い続ける
 * （最新にするときは data/cache の *.osm.pbf を消す）。PBF_URL で指定も可
 */
async function resolvePbfUrl(): Promise<string> {
  if (process.env.PBF_URL) return process.env.PBF_URL;
  const cached = readSources().pbf?.url;
  if (cached && existsSync(`${CACHE}/${cached.split("/").pop()}`))
    return cached;
  const res = await fetch(PBF_LATEST, {
    method: "HEAD",
    redirect: "manual",
    headers: { "User-Agent": UA },
  });
  const location = res.headers.get("location");
  if (!location)
    throw new Error(
      `${PBF_LATEST} のリダイレクト先が取れません (HTTP ${res.status})`,
    );
  return new URL(location, PBF_LATEST).href;
}

function run(
  cmd: string,
  args: string[],
  opts: { capture?: boolean } = {},
): string {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  try {
    return (
      execFileSync(cmd, args, {
        stdio: opts.capture ? "pipe" : "inherit",
        encoding: "utf8",
      }) ?? ""
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `${cmd} が見つかりません。README の「データ生成」を参照してインストールしてください`,
      );
    }
    throw e;
  }
}

async function* readSeq(path: string): AsyncGenerator<Feature> {
  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of rl) {
    // GeoJSONSeq の行頭レコードセパレータ (RS) を除く
    const s = (line.startsWith("\u001e") ? line.slice(1) : line).trim();
    if (s) yield JSON.parse(s);
  }
}

// ---- 空間処理 ----

const isArea = (f: Feature): f is Area =>
  f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon";

type Admin = { name: string; f: Area; b: BBox };

const bboxesOverlap = (a: BBox, b: BBox) =>
  a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/**
 * 島と重なる行政区域の名前を、重なる面積の大きい順に返す。
 * 境界を簡略化しているので、島の面積の 5% 未満しか重ならない区域は、境界のずれとみなして外す（最も重なる区域は残す）
 */
function adminsOf(f: Area, b: BBox, admins: Admin[]): string[] {
  const hits = admins.filter(
    (a) => bboxesOverlap(b, a.b) && booleanIntersects(f, a.f),
  );
  if (hits.length < 2) return hits.map((a) => a.name);
  const total = area(f);
  return hits
    .map((a) => {
      const i = intersect(featureCollection([f, a.f]));
      return { name: a.name, share: i ? area(i) / total : 0 };
    })
    .sort((x, y) => y.share - x.share)
    .filter((a, i) => i === 0 || a.share >= 0.05)
    .map((a) => a.name);
}

const inBBox = (p: number[], b: BBox) =>
  p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

/** 点を 0.1° 格子で引けるようにする */
function pointGrid(points: [number, number][]) {
  const cells = new Map<string, number[]>();
  points.forEach((p, i) => {
    const k = `${Math.floor(p[0] * 10)},${Math.floor(p[1] * 10)}`;
    const cell = cells.get(k);
    if (cell) cell.push(i);
    else cells.set(k, [i]);
  });
  return (b: BBox): number[] => {
    const hits: number[] = [];
    for (let x = Math.floor(b[0] * 10); x <= Math.floor(b[2] * 10); x++) {
      for (let y = Math.floor(b[1] * 10); y <= Math.floor(b[3] * 10); y++) {
        for (const i of cells.get(`${x},${y}`) ?? [])
          if (inBBox(points[i], b)) hits.push(i);
      }
    }
    return hits;
  };
}

// ---- 本体 ----

async function main() {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const config: DifficultyConfig = JSON.parse(
    readFileSync("config/difficulty.json", "utf8"),
  );

  // 1. 取得
  const pbfUrl = await resolvePbfUrl();
  const pbf = `${CACHE}/${pbfUrl.split("/").pop()}`;
  const pbfSource = await ensureSource("pbf", pbfUrl, pbf);
  const landZip = `${CACHE}/land-polygons-complete-4326.zip`;
  const landSource = await ensureSource("land", LAND_URL, landZip);
  const osmTimestamp = run(
    "osmium",
    ["fileinfo", "-g", "header.option.osmosis_replication_timestamp", pbf],
    {
      capture: true,
    },
  ).trim();

  // 2. 陸地ポリゴンを日本周辺で切り抜く
  const land = `${CACHE}/land.geojsonseq`;
  if (!existsSync(land)) {
    const b = CLIP_BBOX.map(String);
    run("ogr2ogr", [
      "-f",
      "GeoJSONSeq",
      "-spat",
      ...b,
      "-clipsrc",
      "spat_extent",
      `${land}.tmp`,
      `/vsizip/${landZip}/land-polygons-complete-4326/land_polygons.shp`,
    ]);
    renameSync(`${land}.tmp`, land);
  }

  // 3. OSM から島・水域・都道府県・市区町村を抽出（抽出条件を変えたら作り直す）
  const filterHash = createHash("sha256")
    .update(OSMIUM_FILTER.join())
    .digest("hex")
    .slice(0, 8);
  const features = `${CACHE}/features-${pbfUrl.split("/").pop()}-${filterHash}.geojsonseq`;
  if (!existsSync(features)) {
    const filtered = `${CACHE}/filtered.osm.pbf`;
    run("osmium", [
      "tags-filter",
      pbf,
      ...OSMIUM_FILTER,
      "-o",
      filtered,
      "--overwrite",
    ]);
    run("osmium", [
      "export",
      filtered,
      "-c",
      "scripts/data/osmium-export.json",
      "-f",
      "geojsonseq",
      "-o",
      `${features}.tmp`,
      "--overwrite",
    ]);
    renameSync(`${features}.tmp`, features);
  }

  // 4. 仕分け（水域はそのままタイル用に書き出す）
  const water = createWriteStream(`${CACHE}/water.geojsonseq`);
  const polyIslands: { id: string; tags: Tags; f: Area }[] = [];
  const nodeIslands: { id: string; tags: Tags; p: [number, number] }[] = [];
  const prefs: Admin[] = [];
  const cities: Admin[] = [];
  for await (const f of readSeq(features)) {
    const tags = (f.properties ?? {}) as Tags;
    const id = `${String(tags["@type"])[0]}${tags["@id"]}`;
    if (tags.place === "island" || tags.place === "islet") {
      if (f.geometry.type === "Point")
        nodeIslands.push({
          id,
          tags,
          p: f.geometry.coordinates as [number, number],
        });
      else if (isArea(f)) polyIslands.push({ id, tags, f });
    } else if (isArea(f) && tags.natural === "water") {
      const km2 = area(f) / 1e6;
      if (km2 >= WATER_MIN_KM2)
        water.write(
          `${JSON.stringify({ ...f, properties: {}, tippecanoe: { minzoom: waterMinZoom(km2) } })}\n`,
        );
    } else if (
      isArea(f) &&
      tags.boundary === "administrative" &&
      (tags.admin_level === "4" || tags.admin_level === "7")
    ) {
      // 判定を速くするため簡略化（約50m）。境界ぎりぎりの小さな島を取り違える可能性はある
      const s = simplify(f, { tolerance: 0.0005 });
      (tags.admin_level === "4" ? prefs : cities).push({
        name: tags["name:ja"] ?? tags.name ?? "",
        f: s,
        b: bbox(s),
      });
    }
  }
  await new Promise((r) => water.end(r));
  console.log(
    `polygon islands: ${polyIslands.length}, node islands: ${nodeIslands.length}, prefs: ${prefs.length}, cities: ${cities.length}`,
  );

  // 5. 陸地ポリゴンとの対応付け（node の島に形状を与える / 同じ陸地を指す polygon の島を検出）
  const polyPoints = polyIslands.map(
    (x) => pointOnFeature(x.f).geometry.coordinates as [number, number],
  );
  const points = [...nodeIslands.map((x) => x.p), ...polyPoints];
  const lookup = pointGrid(points);
  const landOf = new Array<number | undefined>(points.length);
  const lands: { f?: Area; km2: number }[] = [];
  for await (const f of readSeq(land)) {
    if (!isArea(f)) continue;
    const hits = lookup(bbox(f));
    if (hits.length === 0) continue;
    const km2 = area(f) / 1e6;
    if (km2 > MAINLAND_KM2) continue;
    const inside = hits.filter((i) => booleanPointInPolygon(points[i], f));
    if (inside.length === 0) continue;
    const hasNode = inside.some((i) => i < nodeIslands.length);
    lands.push({ f: hasNode ? f : undefined, km2 });
    for (const i of inside) landOf[i] = lands.length - 1;
  }

  const dropped: Dropped[] = [];
  const candidates: { id: string; tags: Tags; f: Area; p: [number, number] }[] =
    [];
  const claimed = new Set<number>();
  polyIslands.forEach((x, k) => {
    const l = landOf[nodeIslands.length + k];
    const ratio = l === undefined ? 0 : area(x.f) / 1e6 / lands[l].km2;
    if (l !== undefined && ratio > 0.8 && ratio < 1.25) claimed.add(l);
    candidates.push({ ...x, p: polyPoints[k] });
  });
  const nodesPerLand = new Map<number, number>();
  for (let i = 0; i < nodeIslands.length; i++) {
    const l = landOf[i];
    if (l !== undefined) nodesPerLand.set(l, (nodesPerLand.get(l) ?? 0) + 1);
  }
  nodeIslands.forEach((x, i) => {
    const l = landOf[i];
    const name = x.tags["name:ja"] ?? x.tags.name;
    const f = l === undefined ? undefined : lands[l].f;
    if (l === undefined || !f)
      dropped.push({
        id: x.id,
        name,
        reason: "陸地ポリゴンなし（海上・本土・湖や川の中）",
      });
    else if (claimed.has(l))
      dropped.push({ id: x.id, name, reason: "polygon の島と重複" });
    else if ((nodesPerLand.get(l) ?? 0) > 1)
      dropped.push({ id: x.id, name, reason: "同じ陸地に複数の node" });
    else candidates.push({ id: x.id, tags: x.tags, f, p: x.p });
  });

  // 6. 出題対象の絞り込みと属性付与
  const islands: (Omit<
    Island,
    "sitelinks" | "score" | "band" | "bandByArea" | "similarNeighbors"
  > & {
    f: Area;
  })[] = [];
  let unnamed = 0;
  for (const c of candidates) {
    const attrs = islandAttributes(c.tags);
    if (!attrs) {
      unnamed++;
      continue;
    }
    if (EXCLUDED_NAMES.has(attrs.name)) continue;
    const areaKm2 = area(c.f) / 1e6;
    if (areaKm2 < MIN_AREA_KM2) {
      dropped.push({ id: c.id, name: attrs.name, reason: "小さすぎる" });
      continue;
    }
    const b = bbox(c.f);
    const admins = adminsOf(c.f, b, prefs);
    const islandPrefs = admins.filter((n) => PREFECTURES.has(n));
    if (islandPrefs.length === 0) {
      const disputed = DISPUTED_BBOXES.some((b) => inBBox(c.p, b));
      if (!disputed || !attrs.nameJa) {
        const reason =
          admins.length > 0
            ? `国外（${admins.join("、")}）`
            : disputed
              ? "係争地で name:ja なし"
              : "都道府県外";
        dropped.push({ id: c.id, name: attrs.name, reason });
        continue;
      }
    }
    const island = {
      id: c.id,
      ...attrs,
      prefs: islandPrefs,
      cities: adminsOf(c.f, b, cities),
      areaKm2,
      bbox: b,
      center: c.p,
      shapeUniqueness: shapeUniqueness(c.f),
      f: c.f,
    };
    islands.push(island);
  }

  // 同じ wikidata を持つ島: 同名なら二重登録なので大きい方を残す。
  // 名前が違うなら諸島などの wikidata が付いているので、知名度に使わないよう外す
  const byWikidata = Map.groupBy(
    islands.filter((x) => x.wikidata),
    (x) => x.wikidata,
  );
  const drop = new Set<(typeof islands)[number]>();
  for (const group of byWikidata.values()) {
    if (group.length < 2) continue;
    if (group.every((x) => x.name === group[0].name)) {
      const keep = group.reduce((a, b) => (a.areaKm2 >= b.areaKm2 ? a : b));
      for (const x of group.filter((x) => x !== keep)) {
        drop.add(x);
        dropped.push({
          id: x.id,
          name: x.name,
          reason: `wikidata 重複（${keep.id} を採用）`,
        });
      }
    } else {
      for (const x of group) x.wikidata = undefined;
    }
  }
  islands.splice(0, islands.length, ...islands.filter((x) => !drop.has(x)));

  // 7. Wikidata（知名度・人口）
  const wd = await fetchWikidata([
    ...new Set(islands.flatMap((x) => (x.wikidata ? [x.wikidata] : []))),
  ]);

  // 8. 難易度
  const neighbors = similarNeighbors(
    islands,
    config.density.radiusKm,
    config.density.log10AreaTolerance,
  );
  const metrics = islands.map((x, i) => {
    const population =
      x.population ?? (x.wikidata ? wd[x.wikidata]?.population : undefined);
    return {
      areaKm2: x.areaKm2,
      sitelinks: x.wikidata ? (wd[x.wikidata]?.sitelinks ?? 0) : 0,
      inhabited: (population ?? 0) > 0,
      shapeUniqueness: x.shapeUniqueness,
      similarNeighbors: neighbors[i],
      population,
    };
  });
  const scores = easeScores(metrics, config.weights);
  const bands = assignBands(scores, config.bands);
  const areaOnly = assignBands(
    easeScores(metrics, {
      area: 1,
      fame: 0,
      inhabited: 0,
      shape: 0,
      density: 0,
    }),
    config.bands,
  );

  const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  const result: Island[] = islands.map(({ f: _f, ...x }, i) => ({
    ...x,
    population: metrics[i].population,
    areaKm2: round(x.areaKm2, 4),
    bbox: x.bbox.map((v) => round(v, 5)) as BBox,
    center: [round(x.center[0], 5), round(x.center[1], 5)],
    sitelinks: metrics[i].sitelinks,
    wikipedia: x.wikidata ? wd[x.wikidata]?.jawiki : undefined,
    shapeUniqueness: round(x.shapeUniqueness, 3),
    similarNeighbors: neighbors[i],
    score: round(scores[i], 4),
    band: bands[i],
    bandByArea: areaOnly[i],
  }));

  // 9. 書き出し
  writeFileSync(`${OUT}/islands.json`, JSON.stringify(result));
  const islandSeq = createWriteStream(`${CACHE}/islands.geojsonseq`);
  for (const x of islands)
    islandSeq.write(
      `${JSON.stringify({ ...x.f, properties: { id: x.id } })}\n`,
    );
  await new Promise((r) => islandSeq.end(r));

  const meta = {
    generatedAt: new Date().toISOString(),
    osmTimestamp,
    sources: {
      osm: pbfSource,
      landPolygons: landSource,
      wikidata: "https://query.wikidata.org/sparql",
    },
    conditions: {
      osmiumFilter: OSMIUM_FILTER,
      clipBBox: CLIP_BBOX,
      mainlandKm2: MAINLAND_KM2,
      excludedNames: [...EXCLUDED_NAMES],
      minAreaKm2: MIN_AREA_KM2,
      waterMinKm2: WATER_MIN_KM2,
      difficulty: config,
    },
    counts: {
      polygonIslands: polyIslands.length,
      nodeIslands: nodeIslands.length,
      unnamed,
      dropped: dropped.length,
      islands: result.length,
    },
    license: "ODbL 1.0 (© OpenStreetMap contributors)",
  };
  writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 2));
  writeReport("data/report.md", result, dropped, meta, config);
  console.log(
    `islands: ${result.length} → ${OUT}/islands.json, data/report.md`,
  );

  // 10. ベクタタイル（タイル設計の調整はフェーズ4で行う）
  run("tippecanoe", [
    "-o",
    `${OUT}/base.pmtiles`,
    "--force",
    "-Z3",
    "-z12",
    "--no-tiny-polygon-reduction",
    "--no-feature-limit",
    "--no-tile-size-limit",
    "-L",
    `land:${land}`,
    "-L",
    `water:${CACHE}/water.geojsonseq`,
    "-L",
    `islands:${CACHE}/islands.geojsonseq`,
  ]);
}

// ---- Wikidata ----

type WdEntry = { sitelinks: number; population?: number; jawiki?: string };

const JAWIKI = "https://ja.wikipedia.org/";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  tries = 5,
): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    if (i >= tries - 1 || (res.status !== 429 && res.status < 500))
      throw new Error(`${url}: HTTP ${res.status}`);
    const wait = Number(res.headers.get("retry-after")) || 5 * 2 ** i;
    console.log(`HTTP ${res.status}, ${wait}s 待って再試行`);
    await sleep(wait * 1000);
  }
}

async function fetchWikidata(qids: string[]): Promise<Record<string, WdEntry>> {
  // 取得項目を増やしたらファイル名を変えて取り直す（v2: jawiki を追加）
  const path = `${CACHE}/wikidata-v2.json`;
  const cache: Record<string, WdEntry> = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {};
  const todo = qids.filter((q) => !(q in cache));
  for (let i = 0; i < todo.length; i += 200) {
    const chunk = todo.slice(i, i + 200);
    console.log(`wikidata ${i + chunk.length}/${todo.length}`);
    const query = `SELECT ?item ?links ?pop ?ja WHERE {
      VALUES ?item { ${chunk.map((q) => `wd:${q}`).join(" ")} }
      ?item wikibase:sitelinks ?links .
      OPTIONAL { ?item wdt:P1082 ?pop }
      OPTIONAL { ?ja schema:about ?item; schema:isPartOf <${JAWIKI}> }
    }`;
    const res = await fetchWithRetry("https://query.wikidata.org/sparql", {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ query }),
    });
    const json = (await res.json()) as {
      results: {
        bindings: {
          item: { value: string };
          links: { value: string };
          pop?: { value: string };
          ja?: { value: string };
        }[];
      };
    };
    for (const q of chunk) cache[q] = { sitelinks: 0 }; // リダイレクト・削除済みの ID は 0
    for (const b of json.results.bindings) {
      const e = cache[b.item.value.split("/").pop() ?? ""];
      if (!e) continue;
      e.sitelinks = Number(b.links.value);
      if (b.pop)
        e.population = Math.max(e.population ?? 0, Number(b.pop.value));
      if (b.ja)
        e.jawiki = decodeURIComponent(
          b.ja.value.slice(`${JAWIKI}wiki/`.length),
        );
    }
    writeFileSync(path, JSON.stringify(cache));
    await sleep(1000);
  }
  return cache;
}

await main();
