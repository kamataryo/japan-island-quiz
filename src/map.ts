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

// MapLibre v6 は Worker を本体と同じ場所から import.meta.url 基準で読むが、
// Vite の事前バンドルで場所がずれて 404 になり、エラーなしで止まる。依存ごとバンドルした Worker を明示する
setWorkerUrl(workerUrl);
addProtocol("pmtiles", new Protocol().tile);

/** マーカー（赤い円）の半径 px。島の外接円がこれより小さく写るときだけ表示する */
const MARKER_RADIUS = 16;
/** タイルは z3 から。これより引くと地図が消える */
const MIN_ZOOM = 3;

const token = (name: string) =>
  getComputedStyle(document.documentElement)
    .getPropertyValue(`--c-${name}`)
    .trim();

const NONE: FilterSpecification = ["==", ["get", "id"], ""];

/** 地名ラベルを一切含まない自前のスタイル */
function style(): StyleSpecification {
  const url = new URL(
    `${import.meta.env.BASE_URL}data/base.pmtiles`,
    location.href,
  ).href;
  const edge = { "line-color": token("coast"), "line-width": 1 };
  return {
    version: 8,
    sources: {
      base: {
        type: "vector",
        url: `pmtiles://${url}`,
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
      {
        id: "water",
        type: "fill",
        source: "base",
        "source-layer": "water",
        paint: { "fill-color": token("sea") },
      },
      // 湖や川の中の島は land に含まれないので、出題対象の島も陸として塗る
      {
        id: "islands",
        type: "fill",
        source: "base",
        "source-layer": "islands",
        paint: { "fill-color": token("land") },
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
      {
        id: "target-fill",
        type: "fill",
        source: "base",
        "source-layer": "islands",
        filter: NONE,
        paint: { "fill-color": token("highlight-fill") },
      },
      {
        id: "target-line",
        type: "line",
        source: "base",
        "source-layer": "islands",
        filter: NONE,
        layout: { "line-join": "round" },
        paint: { "line-color": token("highlight"), "line-width": 4 },
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

export function createMap(container: HTMLElement): Promise<MapLibreMap> {
  const map = new MapLibreMap({
    container,
    style: style(),
    bounds: [128, 26, 146, 45],
    minZoom: MIN_ZOOM,
    maxZoom: 16,
    attributionControl: { compact: false },
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
    const timer = setTimeout(() => reject(new Error("地図の読み込みがタイムアウトしました")), 20_000);
    map.once("load", () => {
      clearTimeout(timer);
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
  map.setFilter("target-line", filter);
  if (!target) map.on("zoom", () => updateMarker(map));
  target = island;
  updateMarker(map);
  map.fitBounds(bounds, { padding: 16, duration: animate ? 800 : 0 });
}
