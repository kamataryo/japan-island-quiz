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

/** ○× を URL に入れる形（正解を 1 とする 0/1 の列）へ */
const formatResults = (results: readonly boolean[]) =>
  results.map((ok) => (ok ? "1" : "0")).join("");

/** 結果をシェアする URL。同じシードで同じ問題に挑戦でき、挑戦した人は1問ずつ比べられる */
export function shareUrl(
  base: string,
  mode: ModeDef,
  results: readonly boolean[],
  seed: number,
): string {
  const score = results.filter(Boolean).length;
  return new URL(
    `${sharePath(mode.id, score)}?seed=${formatSeed(seed)}&r=${formatResults(results)}`,
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
export function shareText(
  mode: ModeDef,
  results: readonly boolean[],
  rival?: number,
): string {
  const score = results.filter(Boolean).length;
  const marks = results.map((ok) => (ok ? "○" : "×")).join("");
  const rows = marks.match(/.{1,5}/gu)?.join(" ") ?? "";
  // 挑戦の結果は勝敗も入れる（相手が返したくなるように）
  const vs =
    rival === undefined
      ? ""
      : `\n${rival}問正解の挑戦に${score}問正解で${score > rival ? "勝利！" : score === rival ? "引き分け" : "敗北…"}`;
  // SNS で結果が集まるようにハッシュタグを付ける
  return `${scoreTitle(mode, score, results.length)}${vs}\n${rows}\n#日本の島クイズ`;
}

/**
 * シェアされたリンクから始める挑戦。score はシェアした人の得点、results はその ○×
 * （古いリンクには ○× がない）
 */
export type Challenge = {
  mode: ModeDef;
  seed: number;
  score?: number;
  results?: boolean[];
};

/** トップページの ?mode=&seed=&score=&r= を読む。モードかシードが読めなければ挑戦ではない */
export function parseChallenge(search: string): Challenge | undefined {
  const q = new URLSearchParams(search);
  const mode = modeById(q.get("mode"));
  const seed = parseSeed(q.get("seed"));
  if (!mode || seed === undefined) return;
  const s = q.get("score");
  const n = s && /^\d+$/.test(s) ? Number(s) : undefined;
  const score = n !== undefined && n <= mode.count ? n : undefined;
  // ○× は出題数・得点と合うときだけ使う（出題数を変えた後の古いリンクで表がずれないように）
  const r = q.get("r") ?? "";
  const results = [...r].map((x) => x === "1");
  const valid =
    /^[01]+$/.test(r) &&
    r.length === mode.count &&
    results.filter(Boolean).length === score;
  return { mode, seed, score, results: valid ? results : undefined };
}

/** 挑戦した結果の一言 */
export function versus(mine: number, theirs: number): string {
  if (mine > theirs) return "あなたの勝ち！";
  if (mine === theirs) return "引き分け";
  return "挑戦相手の勝ち";
}
