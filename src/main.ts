import "./styles/base.css";
import "./styles/app.css";
import config from "../config/difficulty.json";
import regions from "../config/regions.json";
import type { Island } from "../scripts/data/pipeline.ts";
import { createMap, showIsland } from "./map.ts";
import { pickChoices } from "./quiz/choices.ts";
import { islandsIn, pickQuestions } from "./quiz/game.ts";
import { questionBounds } from "./quiz/zoom.ts";

const QUESTIONS = 10;

/** 遊び方（難易度帯か地域）。questions から出題し、choices から選択肢を作る */
type Mode = {
  name: string;
  questions: Island[];
  choices: Island[];
  weight?: (x: Island) => number;
};

/**
 * 地域モードは帯を混ぜて出すので、均等だと小さな岩ばかりになる。面積^0.25 で大きい島を出やすくする
 * （瀬戸内海で 1ゲームの内訳が おおよそ かんたん0.4・ふつう2.8・むずい4.7・おに2.0 問になる）
 */
const regionWeight = (x: Island) => x.areaKm2 ** 0.25;

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;
const panel = $("#panel");
const progress = $("#progress");
const live = $("#live");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

type Answer = { island: Island; choice: Island };

declare global {
  interface Window {
    /** 開発・調査用に MapLibre の Map を露出する（コンソールから触る） */
    __map?: Awaited<ReturnType<typeof createMap>>;
  }
}

/** HTML 文字列を組み立てる。値は必ず esc() を通す */
const esc = (s: string | number) =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function announce(text: string) {
  // 同じ文言でも読み上げられるよう、一度空にしてから入れる
  live.textContent = "";
  requestAnimationFrame(() => {
    live.textContent = text;
  });
}

function formatArea(km2: number): string {
  if (km2 >= 1)
    return `${km2.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}km²`;
  return `約${Math.round(km2 * 1e6).toLocaleString("ja-JP")}m²`;
}

/** 答え合わせで出す島の詳細（読み・都道府県・面積・人口） */
function describe(x: Island): string {
  return [
    x.yomi && `読み: ${x.yomi}`,
    x.pref,
    `面積 ${formatArea(x.areaKm2)}`,
    x.population && `人口 ${x.population.toLocaleString("ja-JP")}人`,
  ]
    .filter(Boolean)
    .join("・");
}

const newTab = `<span class="visually-hidden">（新しいタブで開く）</span>`;

/** 地図に表示中の島の説明と、外部サイトへのリンク */
function viewing(x: Island): string {
  const [lng, lat] = x.center;
  // 島名で検索すると別の場所に当たることがあるので、島の上の代表点で開く
  const gmap = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const wiki =
    x.wikipedia &&
    `https://ja.wikipedia.org/wiki/${encodeURIComponent(x.wikipedia)}`;
  return `
    <p>${esc(`地図に表示中: ${x.name}（${describe(x)}）`)}</p>
    <p class="row links">
      ${wiki ? `<a href="${esc(wiki)}" target="_blank" rel="noopener">Wikipedia「${esc(x.wikipedia ?? "")}」↗${newTab}</a>` : ""}
      <a href="${esc(gmap)}" target="_blank" rel="noopener">Google マップ ↗${newTab}</a>
    </p>`;
}

/**
 * 回答を集計に送り、その島のみんなの正答率を文にして返す。
 * 集計 API がない（vite dev など）・失敗したときは空文字（クイズはそのまま続けられる）
 */
async function record(x: Island, correct: boolean): Promise<string> {
  try {
    const res = await fetch("api/answers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: x.id, correct }),
    });
    if (!res.ok) return "";
    const s = (await res.json()) as { answers: number; correct: number };
    const rate = Math.round((s.correct / s.answers) * 100);
    return `${x.name}のみんなの正答率 ${rate}%（${s.answers.toLocaleString("ja-JP")}回答）`;
  } catch {
    return "";
  }
}

// ---- 画面 ----

async function main() {
  panel.innerHTML = `<p>読み込み中…</p>`;
  let islands: Island[];
  let map: Awaited<ReturnType<typeof createMap>>;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/islands.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    [islands, map] = await Promise.all([
      res.json() as Promise<Island[]>,
      createMap($("#map")),
    ]);
    window.__map = map;
  } catch (e) {
    panel.innerHTML = `<p class="feedback feedback--wrong" role="alert">× データを読み込めませんでした（${esc(String(e))}）</p>`;
    return;
  }

  /** 答え合わせで、指定した島へ地図を移す */
  const jump = (x: Island) =>
    showIsland(
      map,
      x,
      questionBounds(x.bbox, () => 0.5),
      !reduceMotion.matches,
    );

  const bands: Mode[] = config.bands.map((b, i) => ({
    name: b.name,
    questions: islands.filter((x) => x.band === i),
    choices: islands,
  }));
  // 地域モードは難易度を問わず出題し、選択肢も地域内の島から作る
  // （外の島が混ざると、それだけで不正解と分かってしまうため）
  const areas: Mode[] = regions.map((r) => {
    const xs = islandsIn(islands, r.polygon);
    return { name: r.name, questions: xs, choices: xs, weight: regionWeight };
  });
  const modes = [...bands, ...areas];

  function start() {
    progress.textContent = "";
    const buttons = (ms: Mode[]) =>
      ms
        .map((m) => {
          const i = modes.indexOf(m);
          return `
          <li><button class="btn choice" type="button" data-key="${i + 1}" data-mode="${i}">
            <kbd>${i + 1}</kbd><span>${esc(m.name)}
            <small class="mark">${m.questions.length.toLocaleString("ja-JP")}島</small></span>
          </button></li>`;
        })
        .join("");
    panel.innerHTML = `
      <h2>難易度を選んでください</h2>
      <ul class="choices">${buttons(bands)}</ul>
      <h2 class="mode-heading">地域で遊ぶ</h2>
      <ul class="choices">${buttons(areas)}</ul>
      <p class="caption">数字キー 1〜${modes.length} でも選べます。</p>`;
    for (const b of panel.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
      b.addEventListener("click", () => play(modes[Number(b.dataset.mode)]));
    }
    panel.querySelector<HTMLButtonElement>("[data-mode]")?.focus();
  }

  function play(mode: Mode) {
    const questions = pickQuestions(
      mode.questions,
      QUESTIONS,
      Math.random,
      mode.weight,
    );
    const answers: Answer[] = [];

    const ask = (q: number) => {
      const island = questions[q];
      const choices = pickChoices(island, mode.choices, Math.random);
      const status = `${q + 1} / ${questions.length} 問目`;
      const showProgress = () => {
        progress.textContent = `${status}・${mode.name}・正解 ${answers.filter((a) => a.choice === a.island).length}`;
      };
      showProgress();
      showIsland(
        map,
        island,
        questionBounds(island.bbox, Math.random),
        !reduceMotion.matches,
      );
      panel.innerHTML = `
        <h2 class="prompt">太い線で囲まれた島はどれ？</h2>
        <ul class="choices">
          ${choices
            .map(
              (c, i) => `
            <li><button class="btn choice" type="button" data-key="${i + 1}" data-index="${i}">
              <kbd>${i + 1}</kbd><span>${esc(c.name)}</span>
            </button></li>`,
            )
            .join("")}
        </ul>
        <div id="feedback"></div>`;
      const buttons = [
        ...panel.querySelectorAll<HTMLButtonElement>("[data-index]"),
      ];
      let answered = false;
      for (const b of buttons) {
        b.addEventListener("click", () => {
          const c = choices[Number(b.dataset.index)];
          if (answered) review(c);
          else answer(c);
        });
      }
      buttons[0]?.focus();
      announce(`${status}。太い線で囲まれた島はどれ？`);

      /** 回答後に選択肢を押すと、その島へ移動して詳しく見られる（誤答も学びに使う） */
      const review = (c: Island) => {
        jump(c);
        buttons.forEach((b, i) => {
          b.setAttribute("aria-pressed", String(choices[i] === c));
        });
        $("#viewing").innerHTML = viewing(c);
        announce(`地図に表示中: ${c.name}（${describe(c)}）`);
      };

      const answer = (choice: Island) => {
        answered = true;
        answers.push({ island, choice });
        showProgress();
        const correct = choice === island;
        buttons.forEach((b, i) => {
          const c = choices[i];
          b.setAttribute("aria-pressed", String(c === island));
          const mark =
            c === island ? "○ 正解" : c === choice ? "× あなたの答え" : "";
          if (!mark) return;
          b.dataset.result = c === island ? "correct" : "wrong";
          // 島名の後ろに続けて置く（狭い画面でも「○ 正解」の途中で折り返さない）
          b.lastElementChild?.insertAdjacentHTML(
            "beforeend",
            ` <small class="mark">${mark}</small>`,
          );
        });
        const head = correct ? "○ 正解！" : `× 不正解… 正解は ${island.name}`;
        const last = q + 1 >= questions.length;
        $("#feedback").innerHTML = `
          <div id="viewing">${viewing(island)}</div>
          <p id="stats" class="caption"></p>
          <p class="next"><button class="btn" type="button" id="next">${last ? "結果を見る ▶" : "次の問題へ ▶"}</button></p>`;
        // 次の問題へ進んだ後に返ってきても、古い要素に書くだけで害はない
        const stats = $("#stats");
        record(island, correct).then((text) => {
          stats.textContent = text;
        });
        const next = $("#next");
        next.addEventListener("click", () => (last ? result() : ask(q + 1)));
        next.focus();
        announce(`${head}。${island.name}、${describe(island)}`);
      };
    };

    const result = () => {
      const score = answers.filter((a) => a.choice === a.island).length;
      progress.textContent = `結果・${mode.name}`;
      // 島名を押すと、その島へ地図を移す
      const shown: Island[] = [];
      const show = (x: Island) =>
        `<button class="link-btn" type="button" data-show="${shown.push(x) - 1}">${esc(x.name)}</button>`;
      panel.innerHTML = `
        <h2 tabindex="-1" id="result">${score} / ${answers.length} 問正解</h2>
        <div class="table-wrap">
          <table class="result-table">
            <thead>
              <tr>
                <th scope="col">問</th>
                <th scope="col">結果</th>
                <th scope="col">正解の島</th>
                <th scope="col">都道府県</th>
                <th scope="col">あなたの答え</th>
              </tr>
            </thead>
            <tbody>
              ${answers
                .map((a, i) => {
                  const ok = a.choice === a.island;
                  return `<tr class="result--${ok ? "correct" : "wrong"}">
                    <td>${i + 1}</td>
                    <td class="result__mark">${ok ? "○ 正解" : "× 不正解"}</td>
                    <th scope="row">${show(a.island)}</th>
                    <td>${esc(a.island.pref ?? "")}</td>
                    <td>${show(a.choice)}</td>
                  </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
        <p class="caption">島の名前を押すと、その島を地図で確かめられます。</p>
        <p class="row">
          <button class="btn" type="button" id="again">もう一度（${esc(mode.name)}）</button>
          <button class="btn" type="button" id="back">難易度を選ぶ</button>
        </p>`;
      for (const b of panel.querySelectorAll<HTMLButtonElement>(
        "[data-show]",
      )) {
        b.addEventListener("click", () => {
          const x = shown[Number(b.dataset.show)];
          jump(x);
          // スマホでは表を下へ読み進めると地図が画面の外に出ているので戻す
          $("#map").scrollIntoView({
            behavior: reduceMotion.matches ? "auto" : "smooth",
            block: "nearest",
          });
          announce(`地図に表示中: ${x.name}（${describe(x)}）`);
        });
      }
      $("#again").addEventListener("click", () => play(mode));
      $("#back").addEventListener("click", start);
      $("#result").focus();
      announce(`結果は ${answers.length} 問中 ${score} 問正解です`);
    };

    ask(0);
  }

  start();
}

// 数字キー 1〜9 で、パネル内の対応するボタンを押す
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
  if ((e.target as HTMLElement).closest("input, textarea, select")) return;
  const button = panel.querySelector<HTMLButtonElement>(
    `[data-key="${e.key}"]`,
  );
  if (!button) return;
  e.preventDefault();
  button.focus();
  button.click();
});

main();
