// 開発用: モードごとに出題対象の島を地図に全部出す（debug.html）
import "./styles/base.css";
import { type GeoJSONSource, Popup } from "maplibre-gl";
import config from "../config/difficulty.json";
import type { Island } from "../scripts/data/pipeline.ts";
import { createMap } from "./map.ts";
import { buildModes } from "./quiz/modes.ts";

const BAND_COLORS = ["#1b9e77", "#7570b3", "#d95f02", "#e7298a"];

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const [islands, map] = await Promise.all([
  fetch(`${import.meta.env.BASE_URL}data/islands.json`).then(
    (r) => r.json() as Promise<Island[]>,
  ),
  createMap($("map")),
]);
const { bands, areas } = buildModes(islands);
const modes = [...bands, ...areas];

// 小さな島は引くとポリゴンが見えないので、代表点も帯の色で出す
map.addSource("points", {
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
});
map.addSource("region", {
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
});
map.addLayer({
  id: "region",
  type: "line",
  source: "region",
  paint: { "line-color": "#000", "line-width": 2, "line-dasharray": [2, 2] },
});
map.addLayer({
  id: "points",
  type: "circle",
  source: "points",
  paint: {
    "circle-radius": 3,
    "circle-color": ["at", ["get", "band"], ["literal", BAND_COLORS]],
    "circle-stroke-color": "#fff",
    "circle-stroke-width": 1,
  },
});
// 代表点か島のポリゴンを押すと、その島の属性を出す
const byId = new Map(islands.map((x) => [x.id, x]));
map.on("click", ["points", "target-fill"], (e) => {
  const x = byId.get(e.features?.[0]?.properties.id);
  if (!x) return;
  const div = document.createElement("div");
  div.style.whiteSpace = "pre-line";
  div.textContent = [
    `${x.name}${x.yomi ? `（${x.yomi}）` : ""}`,
    `${x.prefs.join("・") || "都道府県不明"} ${x.cities.join("・")}・${config.bands[x.band].name}`,
    `面積 ${x.areaKm2.toFixed(3)} km²`,
    x.population != null && `人口 ${x.population}`,
    `sitelinks ${x.sitelinks}・スコア ${x.score.toFixed(3)}`,
    `ID ${x.id}${x.wikidata ? `・${x.wikidata}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
  new Popup().setLngLat(e.lngLat).setDOMContent(div).addTo(map);
});

const select = $("mode") as HTMLSelectElement;
select.innerHTML = modes
  .map((m, i) => `<option value="${i}">${m.name}</option>`)
  .join("");
select.addEventListener("change", show);
show();

function show() {
  const mode = modes[Number(select.value)];
  const xs = mode.questions;
  const filter = ["in", ["get", "id"], ["literal", xs.map((x) => x.id)]];
  for (const id of ["target-fill", "target-casing", "target-line"]) {
    map.setFilter(id, filter as never);
  }
  // 島の塗りと輪郭も凡例の帯の色にする
  const color = [
    "case",
    ...BAND_COLORS.flatMap((c, i) => [
      [
        "in",
        ["get", "id"],
        ["literal", xs.filter((x) => x.band === i).map((x) => x.id)],
      ],
      c,
    ]),
    "#000",
  ];
  map.setPaintProperty("target-fill", "fill-color", color as never);
  map.setPaintProperty("target-line", "line-color", color as never);
  (map.getSource("points") as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: xs.map((x) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: x.center },
      properties: { id: x.id, band: x.band },
    })),
  });
  (map.getSource("region") as GeoJSONSource).setData(
    mode.polygon
      ? {
          type: "Polygon",
          coordinates: [[...mode.polygon, mode.polygon[0]]],
        }
      : { type: "FeatureCollection", features: [] },
  );
  // 帯ごとの島数と、1問あたりにその帯が出る割合（重みの合計の比）
  const w = mode.weight ?? (() => 1);
  const total = xs.reduce((s, x) => s + w(x), 0);
  $("stats").innerHTML = `<table>${config.bands
    .map((b, i) => {
      const ys = xs.filter((x) => x.band === i);
      const share = ys.reduce((s, x) => s + w(x), 0) / total;
      return `<tr><td style="color:${BAND_COLORS[i]}">●</td><td>${b.name}</td><td>${ys.length}島</td><td>${(share * 100).toFixed(0)}%</td></tr>`;
    })
    .join("")}</table>`;
}
