import {
  addProtocol,
  type FilterSpecification,
  type GeoJSONSource,
  type LngLatBoundsLike,
  Map as MapLibreMap,
  type StyleSpecification,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import type { Island } from "../scripts/data/pipeline.ts";
import { gsiToTerrarium } from "./dem.ts";

// MapLibre v6 は Worker を本体と同じ場所から import.meta.url 基準で読むが、
// Vite の事前バンドルで場所がずれて 404 になり、エラーなしで止まる。依存ごとバンドルした Worker を明示する
setWorkerUrl(workerUrl);
addProtocol("pmtiles", new Protocol().tile);

/** 地理院の標高タイル（DEM10B、z1〜14）を terrarium 形式の PNG にして返す */
addProtocol("gsidem", async ({ url }, { signal }) => {
  const res = await fetch(
    `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${url.slice(9)}.png`,
    { signal },
  );
  // 陸から離れた海はタイルがなく 404 になる。0m の平らなタイルとして扱う
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("OffscreenCanvas が使えません");
  if (res.ok) {
    const bitmap = await createImageBitmap(await res.blob(), {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  }
  const image = ctx.getImageData(0, 0, 256, 256);
  gsiToTerrarium(image.data);
  ctx.putImageData(image, 0, 0);
  return { data: await (await canvas.convertToBlob()).arrayBuffer() };
});

/** マーカー（赤い円）の半径 px。島の外接円がこれより小さく写るときだけ表示する */
const MARKER_RADIUS = 16;
/** これより引くと、データのある範囲（日本周辺）の端が見えてしまう */
const MIN_ZOOM = 5;

const token = (name: string) =>
  getComputedStyle(document.documentElement)
    .getPropertyValue(`--c-${name}`)
    .trim();

const NONE: FilterSpecification = ["==", ["get", "id"], ""];

/** 地名ラベルを一切含まない自前のスタイル */
function style(): StyleSpecification {
  const url = (path: string) =>
    new URL(`${import.meta.env.BASE_URL}${path}`, location.href).href;
  const edge = { "line-color": token("coast"), "line-width": 1 };
  return {
    version: 8,
    sources: {
      // 本番は Worker が R2 の base.pmtiles から1枚ずつ返す（ブラウザにキャッシュさせられる）。
      // vite dev には Worker がないので、public/data の PMTiles を直接読む
      base: {
        type: "vector",
        ...(import.meta.env.DEV
          ? { url: `pmtiles://${url("data/base.pmtiles")}` }
          : {
              // {z} などを URL() に通すとエスケープされるので、後ろに付ける
              tiles: [`${url("tiles/")}{z}/{x}/{y}.mvt`],
              minzoom: 3,
              maxzoom: 12,
              // データのある範囲（scripts/data/pipeline.ts の CLIP_BBOX）。外側はリクエストしない
              bounds: [120, 19.5, 156, 50],
            }),
        attribution:
          '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
      },
      marker: {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      },
    },
    layers: [
      {
        id: "sea",
        type: "background",
        paint: { "background-color": token("sea") },
      },
      {
        id: "land",
        type: "fill",
        source: "base",
        "source-layer": "land",
        paint: { "fill-color": token("land") },
      },
      // 湖や川の中の島は land に含まれないので、出題対象の島も陸として塗る。
      // 島の中の池を塗りつぶさないよう、水域はこれとハイライトの塗りより上に重ねる
      // （湖の中の島は、OSM では湖のポリゴンの穴になっているので隠れない）
      {
        id: "islands",
        type: "fill",
        source: "base",
        "source-layer": "islands",
        paint: { "fill-color": token("land") },
      },
      {
        id: "target-fill",
        type: "fill",
        source: "base",
        "source-layer": "islands",
        filter: NONE,
        paint: { "fill-color": token("highlight-fill") },
      },
      // ここに陰影と等高線が入る（addTerrain）。
      // 水域は陰影・等高線より上に置き、湖や池を地図帳のように平らな水色にする
      // （地理院の等高線は OSM の水域と形がずれ、池の上を横切ることがあるため）
      {
        id: "water",
        type: "fill",
        source: "base",
        "source-layer": "water",
        paint: { "fill-color": token("sea") },
      },
      {
        id: "land-edge",
        type: "line",
        source: "base",
        "source-layer": "land",
        paint: edge,
      },
      {
        id: "water-edge",
        type: "line",
        source: "base",
        "source-layer": "water",
        paint: edge,
      },
      {
        id: "islands-edge",
        type: "line",
        source: "base",
        "source-layer": "islands",
        paint: edge,
      },
      // 赤い輪郭の下に紙色の縁取りを敷く。急斜面では陰影が重なって陸が暗くなり
      // （透明度は最大で約 0.5）、赤と陸が直接接すると 3:1 を割るため
      {
        id: "target-casing",
        type: "line",
        source: "base",
        "source-layer": "islands",
        filter: NONE,
        layout: { "line-join": "round" },
        paint: { "line-color": token("paper"), "line-width": 6 },
      },
      {
        id: "target-line",
        type: "line",
        source: "base",
        "source-layer": "islands",
        filter: NONE,
        layout: { "line-join": "round" },
        paint: { "line-color": token("highlight"), "line-width": 3 },
      },
      {
        id: "marker-casing",
        type: "circle",
        source: "marker",
        paint: {
          "circle-radius": MARKER_RADIUS - 1,
          "circle-color": "rgba(0, 0, 0, 0)",
          "circle-stroke-color": token("paper"),
          "circle-stroke-width": 5,
        },
      },
      {
        id: "marker",
        type: "circle",
        source: "marker",
        paint: {
          "circle-radius": MARKER_RADIUS,
          "circle-color": "rgba(0, 0, 0, 0)",
          "circle-stroke-color": token("highlight"),
          "circle-stroke-width": 3,
        },
      },
    ],
  };
}

/**
 * 陰影と等高線（国土地理院）を水域の下に足す。地図の読み込み後に足すので、
 * 地理院のタイルが読めなくても OSM の地図だけでクイズは続けられる（失敗はコンソールに出るだけ）
 */
function addTerrain(map: MapLibreMap): void {
  map.addSource("dem", {
    type: "raster-dem",
    tiles: ["gsidem://{z}/{x}/{y}"],
    tileSize: 256,
    minzoom: 1,
    maxzoom: 14,
    encoding: "terrarium",
    attribution:
      '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル（標高タイル）を加工して作成</a>',
  });
  // 国土地理院最適化ベクトルタイル（試験公開）。等高線の Cntr レイヤーだけ使う（z9〜）
  map.addSource("gsi", {
    type: "vector",
    url: "pmtiles://https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/optimal_bvmap-v1.pmtiles",
    attribution:
      '<a href="https://github.com/gsi-cyberjapan/optimal_bvmap">国土地理院最適化ベクトルタイル</a>',
  });
  // 陰影と等高線は黄色い塗りの上に重ね、出題中の島でも地形が見えるようにする。
  // 赤い太線は最前面に置くので埋もれない
  map.addLayer(
    {
      id: "hillshade",
      type: "hillshade",
      source: "dem",
      paint: {
        "hillshade-shadow-color": token("hill-shadow"),
        "hillshade-highlight-color": token("hill-highlight"),
        "hillshade-accent-color": token("hill-shadow"),
      },
    },
    "water",
  );
  map.addLayer(
    {
      id: "contour",
      type: "line",
      source: "gsi",
      "source-layer": "Cntr",
      paint: {
        "line-color": token("contour"),
        // 7352 は計曲線（値が 50m ごとだけのもの）。太く描く
        "line-width": ["match", ["get", "vt_code"], 7352, 1.2, 0.6],
        "line-opacity": 0.8,
      },
    },
    "water",
  );
}

export function createMap(container: HTMLElement): Promise<MapLibreMap> {
  const map = new MapLibreMap({
    container,
    style: style(),
    bounds: [128, 26, 146, 45],
    minZoom: MIN_ZOOM,
    maxZoom: 16,
    // 最初は開いて表示し、地図を操作すると i アイコンにたたまれる
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    // 地図は目で見るための要素なので、Tab の移動先にしない
    keyboard: false,
    renderWorldCopies: false,
  });
  map.touchZoomRotate.disableRotation();
  map.getCanvas().tabIndex = -1;
  map.on("error", (e) => console.error(e.error));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("地図の読み込みがタイムアウトしました")),
      20_000,
    );
    map.once("load", () => {
      clearTimeout(timer);
      addTerrain(map);
      resolve(map);
    });
    map.once("error", (e) => {
      clearTimeout(timer);
      reject(e.error);
    });
  });
}

let target: Island | undefined;
let markerKey = "";

/**
 * 島の bbox の外接円（中心と半径）が画面上でマーカーより小さいときだけ、マーカーを bbox の中心に出す。
 * ズームのたびに呼び、寄って島がマーカーより大きく写ったら消す
 */
function updateMarker(map: MapLibreMap) {
  const marker = map.getSource("marker") as GeoJSONSource;
  if (!target) return;
  const [w, s, e, n] = target.bbox;
  const center: [number, number] = [(w + e) / 2, (s + n) / 2];
  const c = map.project(center);
  const corner = map.project([e, n]);
  const show = Math.hypot(corner.x - c.x, corner.y - c.y) < MARKER_RADIUS;
  // ズーム中は毎フレーム呼ばれるので、表示状態が変わったときだけ更新する
  const key = show ? target.id : "";
  if (key === markerKey) return;
  markerKey = key;
  marker.setData(
    show
      ? { type: "Point", coordinates: center }
      : { type: "FeatureCollection", features: [] },
  );
}

export function showIsland(
  map: MapLibreMap,
  island: Island,
  bounds: LngLatBoundsLike,
  animate: boolean,
): void {
  const filter: FilterSpecification = ["==", ["get", "id"], island.id];
  map.setFilter("target-fill", filter);
  map.setFilter("target-casing", filter);
  map.setFilter("target-line", filter);
  if (!target) map.on("zoom", () => updateMarker(map));
  target = island;
  updateMarker(map);
  map.fitBounds(bounds, { padding: 16, duration: animate ? 800 : 0 });
}
