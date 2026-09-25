import { area, convex, length, polygonToLine } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

export type Tags = Record<string, string | undefined>;

export function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
}

/** OSM タグから出題に使う属性を取り出す。名前がなければ undefined */
export function islandAttributes(tags: Tags) {
  const name = tags["name:ja"] ?? tags.name;
  if (!name) return undefined;
  const yomi =
    tags["name:ja-Hira"] ?? tags["name:ja_kana"] ?? tags["name:ja-Kana"];
  const population = Number.parseInt(
    tags.population?.replace(/[,\s]/g, "") ?? "",
    10,
  );
  const wikidata = tags.wikidata?.trim();
  return {
    name,
    nameJa: tags["name:ja"],
    nameEn: tags["name:en"],
    yomi: yomi ? toHiragana(yomi) : undefined,
    wikidata: wikidata && /^Q\d+$/.test(wikidata) ? wikidata : undefined,
    population: Number.isFinite(population) ? population : undefined,
  };
}

/**
 * 形のユニークさ（0〜1）。
 * 周長ベースの円形度は海岸線の描き込み量に左右されるので、凸包を使う:
 *   solidity = 面積 / 凸包面積（入り組んだ形ほど小さい）
 *   hullCircularity = 凸包の円形度（細長いほど小さい）
 * どちらも 1 に近い「丸い塊」ほど見分けにくいので、1 - 積 をユニークさとする。
 */
export function shapeUniqueness(f: Feature<Polygon | MultiPolygon>): number {
  const hull = convex(f);
  if (!hull) return 0;
  const hullArea = area(hull);
  const p = length(polygonToLine(hull) as Feature, { units: "meters" });
  const solidity = area(f) / hullArea;
  const hullCircularity = (4 * Math.PI * hullArea) / (p * p);
  return Math.min(1, Math.max(0, 1 - solidity * hullCircularity));
}
