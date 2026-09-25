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
