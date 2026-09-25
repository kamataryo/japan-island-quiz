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

/** これより小さく写る島にはマーカー（赤い円）を重ねる */
const MIN_ISLAND_PX = 16;

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
          "circle-radius": 16,
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

export function showIsland(
  map: MapLibreMap,
  island: Island,
  bounds: LngLatBoundsLike,
  animate: boolean,
): void {
  const filter: FilterSpecification = ["==", ["get", "id"], island.id];
  map.setFilter("target-fill", filter);
  map.setFilter("target-line", filter);
  const marker = map.getSource("marker") as GeoJSONSource;
  marker.setData({ type: "FeatureCollection", features: [] });
  map.once("moveend", () => {
    const [w, s, e, n] = island.bbox;
    const a = map.project([w, s]);
    const b = map.project([e, n]);
    if (Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) < MIN_ISLAND_PX) {
      marker.setData({ type: "Point", coordinates: island.center });
    }
  });
  map.fitBounds(bounds, { padding: 16, duration: animate ? 800 : 0 });
}
