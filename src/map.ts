import {
  addProtocol,
  type FilterSpecification,
  type GeoJSONSource,
  type IControl,
  type LngLatBoundsLike,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  type StyleSpecification,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import type { Island } from "../scripts/data/pipeline.ts";
import { gsiToTerrarium } from "./dem.ts";
import { fillZoom, fitZoom, questionZoom } from "./quiz/zoom.ts";
import { TILES_VERSION } from "./tiles-version.ts";

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
/** 出題時はこれより引かない（縮尺が 50km 前後。引きすぎると島が小さくなりすぎる）。ただし島全体が収まらないときは収まるまで引く */
const MIN_QUESTION_ZOOM = 7;
/** 寄せるときは、凸包が画面の FILL_SHARE を占めるまで寄せる */
const FILL_SHARE = 1 / 16;
/** 寄せるときも、島の幅・高さが画面の 1/SPAN_DIV を超えない（細長い島が横に広がりすぎないように） */
const SPAN_DIV = 3;
/** 寄せるときも島全体が画面に収まるよう、四辺に残す余白 px */
const FIT_PADDING = 16;
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
              tiles: [`${url(`tiles/${TILES_VERSION}/`)}{z}/{x}/{y}.mvt`],
              minzoom: 3,
              maxzoom: 12,
              // データのある範囲（scripts/data/pipeline.ts の CLIP_BBOX）。外側はリクエストしない
              bounds: [120, 19.5, 156, 50],
            }),
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
  });
  // 国土地理院最適化ベクトルタイル（試験公開）。等高線の Cntr レイヤーだけ使う（z9〜）
  map.addSource("gsi", {
    type: "vector",
    url: "pmtiles://https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/optimal_bvmap-v1.pmtiles",
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

// MapLibre はソースごとの出典を文字数の短い順に並べるので、ソースには持たせずここで順番を決める。
// 地理院の分は読み込みに失敗しても出したままにする
const ATTRIBUTION = [
  '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
  '地理院タイル（<a href="https://maps.gsi.go.jp/development/ichiran.html">標高</a>を加工、<a href="https://github.com/gsi-cyberjapan/optimal_bvmap">最適化ベクトル</a>）',
].join(" | ");

export function createMap(container: HTMLElement): Promise<MapLibreMap> {
  const map = new MapLibreMap({
    container,
    style: style(),
    // 開始画面の地図。瀬戸内海のあたり（幅 500px の画面で四国から中国地方が収まる程度）
    center: [133.48, 34.15],
    zoom: 7.05,
    minZoom: MIN_ZOOM,
    maxZoom: 16,
    // 出典は最初は開いて見せ、遊び始めたら i アイコンにたたむ（collapseAttribution）
    attributionControl: { compact: true, customAttribution: ATTRIBUTION },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    // 地図は目で見るための要素なので、Tab の移動先にしない
    keyboard: false,
    renderWorldCopies: false,
    locale: {
      "NavigationControl.ZoomIn": "拡大",
      "NavigationControl.ZoomOut": "縮小",
    },
  });
  map.touchZoomRotate.disableRotation();
  // 地図を動かせることに気づいてもらうため、＋−ボタンを常に出す
  map.addControl(new NavigationControl({ showCompass: false }));
  // zoomIn/zoomOut は「今のズーム ±1」へ動くので、アニメーション中に連打すると途中の値からの ±1 になり
  // 押した回数ほど寄らない。動いている間は、前に押した行き先から動かす。
  // 1段ずつだと場所が分かるまで何度も押すことになるので、1回で2段ずつ動かす
  let goal: number | undefined;
  map.on("moveend", () => {
    goal = undefined;
  });
  const step = (d: number) => {
    goal = Math.min(
      Math.max((goal ?? map.getZoom()) + d, map.getMinZoom()),
      map.getMaxZoom(),
    );
    return goal;
  };
  map.zoomIn = (options, eventData) => map.zoomTo(step(2), options, eventData);
  map.zoomOut = (options, eventData) =>
    map.zoomTo(step(-2), options, eventData);
  map.addControl(recenter);
  map.addControl(new ScaleControl(), "bottom-left");
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

/**
 * 出典を i アイコンにたたむ（押せばまた開く）。MapLibre はドラッグされるまでたたまないが、
 * クイズでは地図をあまり触らず、狭い画面では地図の下部を覆ったままになるため、遊び始めたときに呼ぶ
 */
export function collapseAttribution(map: MapLibreMap): void {
  map
    .getContainer()
    .querySelector(".maplibregl-ctrl-attrib")
    ?.classList.remove("maplibregl-compact-show");
}

const HINT_KEY = "panHintShown";

/**
 * 初めて遊ぶ人に、地図を動かせることを地図の上に重ねて知らせる（1回だけ）。
 * 触れば地図をそのまま動かせるよう、クリックは下に通す。地図が次に動いたら消す
 */
export function showPanHint(map: MapLibreMap): void {
  try {
    if (localStorage.getItem(HINT_KEY)) return;
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    // 保存できない環境では毎回出す
  }
  const hint = document.createElement("div");
  hint.className = "pan-hint";
  hint.setAttribute("aria-hidden", "true");
  // 語の途中で折り返さないよう、まとまりごとに span で包む
  hint.innerHTML =
    "<span>地図はドラッグで</span><span>動かせます</span><br><span>＋−・ピンチ・ホイールで</span><span>拡大縮小</span>";
  map.getContainer().append(hint);
  map.once("movestart", () => hint.remove());
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

/** 出題中の島の最初の表示。島が画面の外に出たら、＋−の下のボタンでここへ戻す */
let home: { center: [number, number]; zoom: number } | undefined;

const recenter = new (class implements IControl {
  el = document.createElement("div");
  onAdd(map: MapLibreMap) {
    this.el.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.el.hidden = true;
    this.el.innerHTML = `<button type="button" class="recenter" aria-label="島の位置へ戻る" title="島の位置へ戻る"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg></button>`;
    // 出題時と同じく動かさずに戻す（経路のタイルを読まないように）
    this.el.firstElementChild?.addEventListener("click", () => {
      if (home) map.jumpTo(home);
    });
    map.on("move", () => this.update(map));
    return this.el;
  }
  onRemove() {
    this.el.remove();
  }
  /** 島の bbox が画面に少しでも入っていれば隠す */
  update(map: MapLibreMap) {
    let away = false;
    if (home && target) {
      const [w, s, e, n] = target.bbox;
      const b = map.getBounds();
      away =
        e < b.getWest() ||
        w > b.getEast() ||
        n < b.getSouth() ||
        s > b.getNorth();
    }
    this.el.hidden = !away;
  }
})();

function highlight(map: MapLibreMap, island: Island) {
  const filter: FilterSpecification = ["==", ["get", "id"], island.id];
  map.setFilter("target-fill", filter);
  map.setFilter("target-casing", filter);
  map.setFilter("target-line", filter);
  if (!target) map.on("zoom", () => updateMarker(map));
  target = island;
  updateMarker(map);
}

/**
 * 出題中・答え合わせの表示。島の代表点を中心に、マーカーがちょうど消える大きさまで寄せる（ズーム7より引かない。島全体が収まらないときは収まるまで引く）。
 * fill のとき（むずい・おにモード）は、凸包が画面の 1/16 を占めるまで寄せる（島の幅・高さが画面の 1/3 以内・最大ズームまで。マーカーが消える大きさより引かない）。
 * 島が画面の外に出たら、ここへ戻るボタンを出す
 */
export function focusIsland(
  map: MapLibreMap,
  island: Island,
  animate: boolean,
  fill: boolean,
): void {
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const fit = fitZoom(island.bbox, island.center, w, h, FIT_PADDING);
  let zoom = Math.max(
    questionZoom(island.bbox, MARKER_RADIUS),
    Math.min(MIN_QUESTION_ZOOM, fit),
  );
  if (fill) {
    // hullKm2 のない古い islands.json では面積で代える（凸包より小さいので少し寄りすぎる）
    const hull = island.hullKm2 ?? island.areaKm2;
    const [west, s, e, n] = island.bbox;
    const span = fitZoom(
      island.bbox,
      [(west + e) / 2, (s + n) / 2],
      w / SPAN_DIV,
      h / SPAN_DIV,
      0,
    );
    const fill = Math.min(
      fillZoom(hull, island.center[1], w * h, FILL_SHARE),
      span,
    );
    zoom = Math.max(zoom, fill);
  }
  home = { center: island.center, zoom: Math.min(zoom, map.getMaxZoom()) };
  highlight(map, island);
  map.easeTo({ ...home, duration: animate ? 800 : 0 });
  recenter.update(map);
}

/** 結果画面の表示。戻るボタンは出さない */
export function showIsland(
  map: MapLibreMap,
  island: Island,
  bounds: LngLatBoundsLike,
  animate: boolean,
): void {
  home = undefined;
  recenter.update(map);
  highlight(map, island);
  map.fitBounds(bounds, { padding: 16, duration: animate ? 800 : 0 });
}

/** 結果画面に移るときに、戻るボタンを消す */
export function hideRecenter(map: MapLibreMap): void {
  home = undefined;
  recenter.update(map);
}
