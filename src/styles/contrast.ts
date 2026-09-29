/** WCAG 2.x の相対輝度とコントラスト比 */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.trim().slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 検証する組み合わせ（tokens.css の --c-* の名前）。min は 4.5 = 通常テキスト、3 = 大きい文字・UI 部品 */
export const PAIRS: { fg: string; bg: string; min: number; use: string }[] = [
  { fg: "ink", bg: "paper", min: 4.5, use: "本文" },
  { fg: "ink", bg: "panel", min: 4.5, use: "パネル内の文字" },
  { fg: "ink", bg: "btn-face", min: 4.5, use: "ボタンの文字" },
  { fg: "ink", bg: "btn-light", min: 4.5, use: "ボタンの文字（ホバー時）" },
  { fg: "ink-sub", bg: "paper", min: 4.5, use: "補足の文字" },
  { fg: "ink-sub", bg: "btn-face", min: 4.5, use: "無効なボタンの文字" },
  { fg: "link", bg: "paper", min: 4.5, use: "リンク" },
  { fg: "on-title", bg: "title", min: 4.5, use: "タイトルバーの文字（左端）" },
  {
    fg: "on-title",
    bg: "title-end",
    min: 4.5,
    use: "タイトルバーの文字（右端）",
  },
  { fg: "correct", bg: "correct-bg", min: 4.5, use: "○正解 の文字" },
  { fg: "ink", bg: "correct-bg", min: 4.5, use: "結果表の正解の行" },
  { fg: "ink", bg: "wrong-bg", min: 4.5, use: "結果表の不正解の行" },
  { fg: "link", bg: "correct-bg", min: 4.5, use: "結果表の島名（正解の行）" },
  { fg: "link", bg: "wrong-bg", min: 4.5, use: "結果表の島名（不正解の行）" },
  { fg: "wrong", bg: "wrong-bg", min: 4.5, use: "×不正解 の文字" },
  { fg: "wrong", bg: "panel", min: 4.5, use: "「難問！」の文字" },
  { fg: "btn-dark", bg: "paper", min: 3, use: "ボタンの枠線" },
  { fg: "btn-dark", bg: "panel", min: 3, use: "ボタンの枠線（パネル上）" },
  { fg: "focus", bg: "paper", min: 3, use: "フォーカス枠" },
  { fg: "focus", bg: "panel", min: 3, use: "フォーカス枠（パネル上）" },
  { fg: "correct", bg: "panel", min: 3, use: "正解ボタンの枠線" },
  { fg: "wrong", bg: "panel", min: 3, use: "不正解ボタンの枠線" },
  { fg: "highlight", bg: "sea", min: 3, use: "出題中の島の輪郭（海側）" },
  { fg: "highlight", bg: "land", min: 3, use: "出題中の島の輪郭（隣の陸側）" },
  {
    fg: "highlight",
    bg: "highlight-fill",
    min: 3,
    use: "出題中の島の輪郭（島の内側）",
  },
  {
    fg: "highlight",
    bg: "paper",
    min: 3,
    use: "出題中の島の輪郭（紙色の縁取りの上。陰影で暗い陸でも保つ）",
  },
  { fg: "coast", bg: "sea", min: 3, use: "海岸線（海と陸の境界）" },
];
