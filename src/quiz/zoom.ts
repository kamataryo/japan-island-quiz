import type { BBox } from "geojson";
import type { Rng } from "./game.ts";

const KM_PER_DEG = 111.32;

/**
 * 出題時に表示する範囲 [[西, 南], [東, 北]]。
 * - 周りの海岸線が見えるよう、島の2倍以上かつ minContextKm 以上の範囲にする
 * - 表示範囲の広さと島の位置をランダムにずらし、ズーム量や中央配置から大きさを推測しにくくする
 */
export function questionBounds(
  bbox: BBox,
  rng: Rng,
  minContextKm = 40,
): [[number, number], [number, number]] {
  const [w, s, e, n] = bbox;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const kx = KM_PER_DEG * Math.cos((cy * Math.PI) / 180);
  const ky = KM_PER_DEG;
  const spanKm = Math.max((e - w) * kx, (n - s) * ky);
  const view = Math.max(spanKm * 2, minContextKm) * (1 + rng() * 0.5);
  // 島がはみ出さない範囲で中心をずらす
  const slack = ((view - spanKm) / 2) * 0.6;
  const ox = (rng() * 2 - 1) * slack;
  const oy = (rng() * 2 - 1) * slack;
  const half = view / 2;
  return [
    [cx + (ox - half) / kx, cy + (oy - half) / ky],
    [cx + (ox + half) / kx, cy + (oy + half) / ky],
  ];
}

/** Web メルカトルの y（世界全体を 0〜1 とする） */
const mercY = (lat: number) =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;

/**
 * 島の bbox の外接円（bbox の中心から北東の角まで）が画面上で radiusPx をわずかに超えるズーム。
 * 地図のマーカーはこの半径より小さく写るときに出るので、ちょうど消える大きさになる
 */
export function questionZoom(bbox: BBox, radiusPx: number): number {
  const [w, s, e, n] = bbox;
  const dx = (e - w) / 2 / 360;
  const dy = mercY((s + n) / 2) - mercY(n);
  // MapLibre のタイルは 512px なので、ズーム z で世界の幅は 512 * 2^z px
  return Math.log2(radiusPx / (512 * Math.hypot(dx, dy))) + 0.05;
}

/** 赤道の長さ（m） */
const EQUATOR_M = 40_075_016.686;

/** 面積 areaKm2 の図形が、緯度 lat で画面 screenPx2（px²）の share を占めるズーム */
export function fillZoom(
  areaKm2: number,
  lat: number,
  screenPx2: number,
  share: number,
): number {
  // ズーム z で 1px は EQUATOR_M * cos(lat) / (512 * 2^z) m
  const mPerPxZ0 = (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / 512;
  return Math.log2(mPerPxZ0 * Math.sqrt((share * screenPx2) / (areaKm2 * 1e6)));
}
