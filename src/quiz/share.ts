import { formatSeed, parseSeed } from "./game.ts";
import { type ModeDef, modeById } from "./mode-defs.ts";

/** 公開先。OGP の画像と URL は絶対 URL が必要（index.html の og:url と合わせる） */
export const SITE_URL = "https://japan-island-quiz.kamataryo.workers.dev/";

/**
 * シェア用のページ（モード × 得点ごとにビルド時に作る）の、サイトの根からの相対パス。
 * このページが得点ごとの OGP 画像を持ち、開くとトップページの挑戦画面へ移る
 */
export const sharePath = (id: string, score: number) => `s/${id}/${score}/`;

/** 得点ごとの OGP 画像の、サイトの根からの相対パス（scripts/ogp.ts で作る） */
export const ogpPath = (id: string, score: number) => `ogp/${id}/${score}.png`;

/** 結果をシェアする URL。同じシードで同じ問題に挑戦できる */
export function shareUrl(
  base: string,
  mode: ModeDef,
  score: number,
  seed: number,
): string {
  return new URL(
    `${sharePath(mode.id, score)}?seed=${formatSeed(seed)}`,
    base,
  ).toString();
}

/** 「むずい」で 10 問中 7 問正解 */
export const scoreTitle = (mode: ModeDef, score: number, questions: number) =>
  `日本の島クイズ【${mode.name}】${questions}問中${score}問正解`;

/**
 * シェアする文。島名は入れない（見た人が同じ問題に挑戦するときのネタバレになるため）。
 * ○× は色の絵文字と違って色に頼らず、読み上げでも分かる。5問ごとに区切る
 */
export function shareText(mode: ModeDef, results: readonly boolean[]): string {
  const score = results.filter(Boolean).length;
  const marks = results.map((ok) => (ok ? "○" : "×")).join("");
  const rows = marks.match(/.{1,5}/gu)?.join(" ") ?? "";
  return `${scoreTitle(mode, score, results.length)}\n${rows}`;
}

/** シェアされたリンクから始める挑戦。score はシェアした人の得点 */
export type Challenge = { mode: ModeDef; seed: number; score?: number };

/** トップページの ?mode=&seed=&score= を読む。モードかシードが読めなければ挑戦ではない */
export function parseChallenge(search: string): Challenge | undefined {
  const q = new URLSearchParams(search);
  const mode = modeById(q.get("mode"));
  const seed = parseSeed(q.get("seed"));
  if (!mode || seed === undefined) return;
  const s = q.get("score");
  const score = s && /^\d+$/.test(s) ? Number(s) : undefined;
  return {
    mode,
    seed,
    score: score !== undefined && score <= mode.count ? score : undefined,
  };
}

/** 挑戦した結果の一言 */
export function versus(mine: number, theirs: number): string {
  if (mine > theirs) return "あなたの勝ち！";
  if (mine === theirs) return "引き分け";
  return "挑戦相手の勝ち";
}
