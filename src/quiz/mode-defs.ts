// Node で直接動かすスクリプト（scripts/ogp.ts）からも読むので、JSON の import 属性を付ける
import difficulty from "../../config/difficulty.json" with { type: "json" };
import regions from "../../config/regions.json" with { type: "json" };

/** 1ゲームの出題数の既定値。モードごとに config の questions で変えられる */
export const DEFAULT_QUESTIONS = 10;

/**
 * モード（難易度帯・地域）の島データによらない情報。クライアント・Worker・ビルド（シェア用のページと OGP 画像）で共有する。
 * - id: URL とファイル名に使う（変えるとシェア済みのリンクが切れる）
 * - name: 表示と集計に使う（変えると集計が分かれる）
 * - count: 1ゲームの出題数（＝得点の上限）。config の questions で変えられる
 * - kind: 難易度帯か地域か（結果に「難易度：おに」「地域：瀬戸内」と出す）
 */
export type ModeDef = {
  id: string;
  name: string;
  count: number;
  kind: ModeKind;
};

export type ModeKind = "band" | "region";

const KIND_NAMES: Record<ModeKind, string> = { band: "難易度", region: "地域" };

export function modeDef(
  m: { id: string; name: string; questions?: number },
  kind: ModeKind,
): ModeDef {
  return {
    id: m.id,
    name: m.name,
    count: m.questions ?? DEFAULT_QUESTIONS,
    kind,
  };
}

/**
 * 結果に出すモード名。「結果：おに」だと成績が「おに」だったように読めるので、何の名前かを添える
 */
export const modeLabel = (m: ModeDef) => `${KIND_NAMES[m.kind]}：${m.name}`;

/** 難易度帯・地域の順（トップページのボタンの順） */
export const MODE_DEFS: ModeDef[] = [
  ...difficulty.bands.map((b) => modeDef(b, "band")),
  ...regions.map((r) => modeDef(r, "region")),
];

export const modeById = (id: string | null) =>
  MODE_DEFS.find((m) => m.id === id);
