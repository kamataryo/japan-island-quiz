import "./styles/base.css";
import "./styles/app.css";
import type { Island } from "../scripts/data/pipeline.ts";
import {
  collapseAttribution,
  createMap,
  showIsland,
  showPanHint,
} from "./map.ts";
import { pickChoices } from "./quiz/choices.ts";
import { pickQuestions } from "./quiz/game.ts";
import { buildModes, type Mode } from "./quiz/modes.ts";
import { questionBounds } from "./quiz/zoom.ts";

const QUESTIONS = 10;

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;
const panel = $("#panel");
const progress = $("#progress");
const live = $("#live");
const home = $<HTMLAnchorElement>("#home");
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

/** 面積の [数値, 単位] */
function formatArea(km2: number): [string, string] {
  if (km2 >= 1)
    return [km2.toLocaleString("ja-JP", { maximumFractionDigits: 1 }), " km²"];
  return [`約${Math.round(km2 * 1e6).toLocaleString("ja-JP")}`, " m²"];
}

/** 答え合わせで出す島の詳細（都道府県・市区町村・面積・人口）の [項目名, 値, 単位] */
function facts(x: Island): [string, string, string?][] {
  const rows: [string, string, string?][] = [];
  if (x.prefs.length) rows.push(["都道府県", x.prefs.join("・")]);
  if (x.cities.length) rows.push(["市区町村", x.cities.join("・")]);
  rows.push(["面積", ...formatArea(x.areaKm2)]);
  if (x.population)
    rows.push(["人口", x.population.toLocaleString("ja-JP"), "人"]);
  return rows;
}

/** 読み上げ用の島の詳細（読み・都道府県・市区町村・面積・人口） */
function describe(x: Island): string {
  return [
    x.yomi && `読み: ${x.yomi}`,
    // 都道府県・市区町村は値だけで通じるので項目名を読まない
    ...facts(x).map(([k, v, unit = ""]) => (unit ? `${k} ${v}${unit}` : v)),
  ]
    .filter(Boolean)
    .join("・");
}

/** 新しいタブで開くリンクの印（四角から右上へ矢印が出るアイコン）と、読み上げ用の説明 */
const newTab = `<svg class="external" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M7 3H3v10h10V9M9 2h5v5M14 2 7 9"/></svg><span class="visually-hidden">（新しいタブで開く）</span>`;

/** 間違いの報告の印（旗のアイコン） */
const flag = `<svg class="external" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 15V2M3 3h9l-2 3 2 3H3"/></svg>`;

/** 地図に表示中の島の説明と、外部サイトへのリンク。間違いを直す・知らせるリンクは行が詰まるので、島名の右の「報告」の中に畳む */
function viewing(x: Island): string {
  const [lng, lat] = x.center;
  // 島名で検索すると別の場所に当たることがあるので、島の上の代表点で開く
  const gmap = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const wiki =
    x.wikipedia &&
    `https://ja.wikipedia.org/wiki/${encodeURIComponent(x.wikipedia)}`;
  // id は OSM の要素の種類の頭文字（n/w/r）＋番号。島の属性はほぼこの要素のタグから作っている
  const osm = `https://www.openstreetmap.org/${{ n: "node", w: "way", r: "relation" }[x.id[0]]}/${x.id.slice(1)}`;
  const report = `https://github.com/kamataryo/japan-island-quiz/issues/new?${new URLSearchParams(
    {
      title: `島の情報の間違い: ${x.name}（${x.id}）`,
      body: `- 島: ${x.name}（${x.id}）\n- OSM: ${osm}\n- 代表点: ${lat},${lng}\n\n## 間違っている内容（名前・読み・都道府県・市区町村・面積・人口など）\n\n\n## 正しい内容と根拠\n\n`,
    },
  )}`;
  return `
    <div class="row island-name">
      <p><strong>${esc(x.name)}</strong>${x.yomi ? `<small>（${esc(x.yomi)}）</small>` : ""}</p>
      <details class="report">
        <summary title="情報の間違いを直す・知らせる">${flag}報告<span class="visually-hidden">（情報の間違いを直す・知らせる）</span></summary>
        <p class="links">
          <a href="${esc(osm)}" target="_blank" rel="noopener">OSM で確認・修正${newTab}</a>
          <a href="${esc(report)}" target="_blank" rel="noopener">間違いを報告${newTab}</a>
        </p>
      </details>
    </div>
    <dl class="facts">
      ${facts(x)
        .map(
          ([k, v, unit]) =>
            `<div><dt>${esc(k)}</dt><dd>${esc(v)}${unit ? `<span class="unit">${esc(unit)}</span>` : ""}</dd></div>`,
        )
        .join("")}
    </dl>
    <p class="row links">
      ${wiki ? `<a href="${esc(wiki)}" target="_blank" rel="noopener">Wikipedia「${esc(x.wikipedia ?? "")}」${newTab}</a>` : ""}
      <a href="${esc(gmap)}" target="_blank" rel="noopener">Google マップ${newTab}</a>
    </p>`;
}

/** 回答を集計に送る。集計 API がない（vite dev など）・失敗しても無視する（クイズはそのまま続けられる） */
function record(x: Island, correct: boolean) {
  fetch("api/answers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: x.id, correct }),
  }).catch(() => {});
}

type Stats = { answers: number; correct: number };

/**
 * 1ゲーム分の島のみんなの回答数と正解数を、ゲーム開始時にまとめて読む（Worker へのリクエストを1ゲーム1回にするため）。
 * まだ回答がない島は含まれない。集計 API がない（vite dev など）・失敗したときは空
 */
async function fetchStats(xs: Island[]): Promise<Map<string, Stats>> {
  try {
    const ids = xs.map((x) => encodeURIComponent(x.id)).join(",");
    const res = await fetch(`api/answers?ids=${ids}`);
    if (!res.ok) return new Map();
    const rows = (await res.json()) as (Stats & { id: string })[];
    return new Map(rows.map((r) => [r.id, r]));
  } catch {
    return new Map();
  }
}

/** 「みんなの正答率 72%・1,234回答」。回答がまだなければ空文字 */
function formatRate(s: Stats | undefined): string {
  if (!s?.answers) return "";
  const rate = Math.round((s.correct / s.answers) * 100);
  return `みんなの正答率 ${rate}%・${s.answers.toLocaleString("ja-JP")}回答`;
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

  const { bands, areas } = buildModes(islands);
  const modes = [...bands, ...areas];

  function start() {
    progress.textContent = "";
    home.hidden = true;
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
    home.hidden = false;
    collapseAttribution(map);
    const questions = pickQuestions(
      mode.questions,
      QUESTIONS,
      Math.random,
      mode.weight,
    );
    const answers: Answer[] = [];
    // 読むのは開始時点の値なので、ゲーム中に他の人が答えた分は反映されない
    const stats = fetchStats(questions);

    const ask = (q: number) => {
      const island = questions[q];
      const choices = pickChoices(island, mode.choices, Math.random);
      const status = `${q + 1} / ${questions.length} 問目`;
      const showProgress = () => {
        progress.textContent = `${status}・${mode.name}・正解 ${answers.filter((a) => a.choice === a.island).length}`;
      };
      showProgress();
      // 出題時は動かさずに切り替える。移動の向きが場所のヒントになり、途中の経路のタイルまで読み込んでしまうため
      showIsland(map, island, questionBounds(island.bbox, Math.random), false);
      // 出題の移動より後に出す（移動で消えないように）
      if (q === 0) showPanHint(map);
      panel.innerHTML = `
        <h2 class="prompt">太い線で囲まれた島はどれ？</h2>
        <p id="rate" class="caption"></p>
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
      // 前の問題でスクロールしていても、先頭（タイトルバーの進捗）から見せる
      scrollTo(0, 0);
      buttons[0]?.focus({ preventScroll: true });
      announce(`${status}。太い線で囲まれた島はどれ？`);
      // 次の問題へ進んだ後に返ってきても、古い要素に書くだけで害はない（読み上げはしない。問題文の邪魔になるため）
      const rate = $("#rate");
      stats.then((m) => {
        rate.textContent = formatRate(m.get(island.id));
      });

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
          <p class="next"><button class="btn" type="button" id="next">${last ? "結果を見る ▶" : "次の問題へ ▶"}</button></p>`;
        record(island, correct);
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
                <th scope="col">正解</th>
                <th scope="col">都道府県</th>
                <th scope="col">回答</th>
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
                    <td>${esc(a.island.prefs.join("・"))}</td>
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

  // 読み込み直さずに最初の画面へ戻す。途中までの回答は送信済みなので、確認はしない
  home.addEventListener("click", (e) => {
    e.preventDefault();
    scrollTo(0, 0);
    start();
  });
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
