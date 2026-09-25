import "./styles/base.css";
import { contrastRatio, PAIRS } from "./styles/contrast.ts";

const SWATCHES: [string, string][] = [
  ["ink", "文字"],
  ["ink-sub", "補足の文字"],
  ["paper", "背景"],
  ["panel", "パネル"],
  ["link", "リンク"],
  ["title", "タイトルバー（左）"],
  ["title-end", "タイトルバー（右）"],
  ["btn-face", "ボタン"],
  ["btn-light", "ボタンの光"],
  ["btn-shadow", "ボタンの影"],
  ["btn-dark", "ボタンの枠線"],
  ["focus", "フォーカス枠"],
  ["correct", "正解"],
  ["correct-bg", "正解の背景"],
  ["wrong", "不正解"],
  ["wrong-bg", "不正解の背景"],
  ["sea", "海"],
  ["land", "陸（低地）"],
  ["land-2", "陸（段彩2）"],
  ["land-3", "陸（段彩3）"],
  ["land-4", "陸（段彩4）"],
  ["coast", "海岸線"],
  ["contour", "等高線"],
  ["highlight", "出題中の島の輪郭"],
  ["highlight-fill", "出題中の島の塗り"],
];

const style = getComputedStyle(document.documentElement);
const token = (name: string) => style.getPropertyValue(`--c-${name}`).trim();

const el = (tag: string, text = "", className = "") => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
};

const swatches = document.querySelector("#swatches");
for (const [name, use] of SWATCHES) {
  const li = el("li", "", "swatch");
  const chip = el("div", "", "swatch__chip");
  chip.style.background = `var(--c-${name})`;
  const label = el("div", use, "swatch__label");
  label.append(el("code", `--c-${name} ${token(name)}`));
  li.append(chip, label);
  swatches?.append(li);
}

const tbody = document.querySelector("#contrast");
for (const { fg, bg, min, use } of PAIRS) {
  const ratio = contrastRatio(token(fg), token(bg));
  const tr = document.createElement("tr");
  tr.append(
    el("td", use),
    el("td", `${fg} ${token(fg)}`),
    el("td", `${bg} ${token(bg)}`),
    el("td", `${ratio.toFixed(2)}:1`),
    el("td", `${min}:1`),
    el("td", ratio >= min ? "○ 合格" : "× 不合格"),
  );
  tbody?.append(tr);
}
