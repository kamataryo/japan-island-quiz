import "./styles/base.css";
import "./styles/app.css";
import type { Island } from "../scripts/data/pipeline.ts";
import { appendInstallHint } from "./install-hint.ts";
import {
  collapseAttribution,
  createMap,
  focusIsland,
  hideRecenter,
  showIsland,
  showPanHint,
} from "./map.ts";
import { nameKey, pickChoices } from "./quiz/choices.ts";
import { newSeed, pickQuestions, seededRng } from "./quiz/game.ts";
import { isHard } from "./quiz/hard.ts";
import {
  GAUGE_CELLS,
  gaugeFilled,
  type ModeStat,
  modeRate,
} from "./quiz/mode-stats.ts";
import { buildModes, type Mode } from "./quiz/modes.ts";
import {
  type Challenge,
  parseChallenge,
  shareText,
  shareUrl,
  versus,
} from "./quiz/share.ts";
import { questionBounds } from "./quiz/zoom.ts";

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;
const panel = $("#panel");
const progress = $("#progress");
const live = $("#live");
const home = $<HTMLAnchorElement>("#home");
const mapEl = $("#map");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

type Answer = { island: Island; choice: Island };

/** OS の共有画面を出せるか。出せなければ結果をクリップボードにコピーする */
const canShare = typeof navigator.share === "function";

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

/** 1プレイの得点を集計に送る。失敗しても無視する */
function recordPlay(mode: string, score: number, questions: number) {
  fetch("api/plays", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode, score, questions }),
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

/**
 * モードごとのみんなの得点を読む。レスポンスは5分キャッシュされるので、トップページに戻るたびに呼んでよい。
 * 集計 API がない（vite dev など）・失敗したときは空
 */
async function fetchModeStats(): Promise<Map<string, ModeStat>> {
  try {
    const res = await fetch("api/modes");
    if (!res.ok) return new Map();
    const rows = (await res.json()) as ModeStat[];
    return new Map(rows.map((r) => [r.mode, r]));
  } catch {
    return new Map();
  }
}

/**
 * ボタンの2行目「みんな 64%」と5マスのゲージ。
 * 正答率が出せないときは何も書かない（「みんな ―」は「みんなー」と呼びかけているように見えるため）。行の高さは空白で取っておく
 */
function modeRateHtml(rate: number | undefined): string {
  if (rate === undefined) return `<span aria-hidden="true">&nbsp;</span>`;
  const k = gaugeFilled(rate);
  const cells = Array.from(
    { length: GAUGE_CELLS },
    (_, i) => `<i${i < k ? ' class="on"' : ""}></i>`,
  ).join("");
  return `みんな<span class="visually-hidden">の正答率</span> ${Math.round(rate * 100)}% <span class="gauge" aria-hidden="true">${cells}</span>`;
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
  const fail = (e: unknown) => {
    panel.innerHTML = `<p class="feedback feedback--wrong" role="alert">× データを読み込めませんでした（${esc(String(e))}）</p>`;
  };
  let islands: Island[];
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/islands.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    islands = await res.json();
  } catch (e) {
    fail(e);
    return;
  }
  // 地図は最初の出題で作る。選択画面の前に作ると、隠すまでの間に一瞬見えてチラつくため
  let map: Awaited<ReturnType<typeof createMap>>;

  /** 答え合わせで、指定した島へ地図を移す */
  const jump = (x: Island, mode: Mode) =>
    focusIsland(map, x, !reduceMotion.matches, !!mode.fill);

  const { bands, areas } = buildModes(islands);
  const modes = [...bands, ...areas];

  function start() {
    progress.textContent = "";
    home.hidden = true;
    // 選択画面では地図を隠す（まだ何も出題していないため）
    mapEl.hidden = true;
    const buttons = (ms: Mode[]) =>
      ms
        .map((m) => {
          const i = modes.indexOf(m);
          return `
          <li><button class="btn choice" type="button" data-key="${i + 1}" data-mode="${i}">
            <kbd>${i + 1}</kbd><span>${esc(m.name)}
            <small class="mark">${m.questions.length.toLocaleString("ja-JP")}島</small>
            <small class="mode-rate">${modeRateHtml(undefined)}</small></span>
          </button></li>`;
        })
        .join("");
    panel.innerHTML = `
      <h2>難易度を選んでください</h2>
      <ul class="choices">${buttons(bands)}</ul>
      <h2 class="mode-heading">地域で遊ぶ</h2>
      <ul class="choices">${buttons(areas)}</ul>
      <p class="caption retro keys-hint">数字キー 1〜${modes.length} でも選べます。</p>
      <p class="caption">島のデータ: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors${newTab}</a>（ODbL）・Wikidata</p>`;
    for (const b of panel.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
      b.addEventListener("click", () => play(modes[Number(b.dataset.mode)]));
    }
    // みんなの正答率は後から差し込む（読めなくても2行目が空のまま遊べる。行の高さは最初から取ってあるのでずれない）
    const buttonsEl = panel.querySelectorAll<HTMLButtonElement>("[data-mode]");
    fetchModeStats().then((stats) => {
      for (const b of buttonsEl) {
        // 読み込み中に別の画面へ移っていたら何もしない
        if (!b.isConnected) return;
        const m = modes[Number(b.dataset.mode)];
        const el = b.querySelector(".mode-rate");
        if (el) el.innerHTML = modeRateHtml(modeRate(stats.get(m.name)));
      }
    });
    // 結果画面などでスクロールしていても、先頭から見せる
    scrollTo(0, 0);
    panel
      .querySelector<HTMLButtonElement>("[data-mode]")
      ?.focus({ preventScroll: true });
  }

  /** シェアされたリンクから開いたときの挑戦画面 */
  function challenge(c: Challenge, mode: Mode) {
    progress.textContent = "";
    home.hidden = true;
    mapEl.hidden = true;
    // 相手の得点を大きく出して、開いた瞬間に「挑まれた」と分かるようにする
    const rival =
      c.score === undefined
        ? ""
        : `<p class="rival-score retro"><span class="rival-score__label">相手の得点</span><span><strong class="rival-score__num">${c.score}</strong> / ${mode.count} 問</span></p>`;
    panel.innerHTML = `
      <h2 tabindex="-1" id="challenge">挑戦状</h2>
      <p class="caption">「${esc(mode.name)}」の${mode.count}問</p>
      ${rival}
      <p>${c.score === undefined ? "同じ問題" : "この人と同じ問題"}に挑戦しますか？</p>
      <p class="row">
        <button class="btn retro" type="button" id="accept">挑戦する（${esc(mode.name)}）</button>
        <button class="btn retro" type="button" id="decline">難易度を選ぶ</button>
      </p>`;
    // 読み込み直したときに挑戦画面へ戻らないよう、URL から外す
    const clear = () => history.replaceState(null, "", location.pathname);
    $("#accept").addEventListener("click", () => {
      clear();
      play(
        mode,
        c.seed,
        c.score === undefined
          ? undefined
          : { score: c.score, results: c.results },
      );
    });
    $("#decline").addEventListener("click", () => {
      clear();
      start();
    });
    $("#challenge").focus();
  }

  /** seed が同じなら同じ問題・選択肢になる。rival は挑戦したときの相手の得点と ○× */
  async function play(
    mode: Mode,
    seed = newSeed(),
    rival?: { score: number; results?: boolean[] },
  ) {
    mapEl.hidden = false;
    if (!map) {
      panel.innerHTML = `<p>読み込み中…</p>`;
      // 作った直後は開始位置の地図が描かれ、最初の島へ移るときにチラつくので、島を描くまで隠す
      // （hidden だと大きさが 0 になり、島へ寄せるズームを測れない）
      mapEl.style.visibility = "hidden";
      try {
        map = await createMap(mapEl);
        window.__map = map;
      } catch (e) {
        fail(e);
        return;
      }
      // この後 ask(0) で島へ移ってから最初に描いたときに見せる
      map.once("render", () => {
        mapEl.style.visibility = "";
      });
    }
    home.hidden = false;
    // 隠している間は大きさが 0 なので測り直す
    map.resize();
    collapseAttribution(map);
    const questions = pickQuestions(
      mode.questions,
      mode.count,
      seededRng(seed),
      mode.weight,
    );
    const answers: Answer[] = [];
    // 前の問題が消去法の手がかりにならないよう、このゲームで出題・選択肢に使った名前は選択肢に出さない
    const used = new Set(questions.map((x) => nameKey(x.name)));
    // 読むのは開始時点の値なので、ゲーム中に他の人が答えた分は反映されない
    const stats = fetchStats(questions);
    // 読み終わっていれば、出題の読み上げに「難問」を入れられるよう手元に置く
    let statsNow: Map<string, Stats> | undefined;
    stats.then((m) => {
      statsNow = m;
    });

    const ask = (q: number) => {
      const island = questions[q];
      // used は前の問題の選択肢で決まり、それもシードで決まるので、同じシードなら同じ選択肢になる
      const choices = pickChoices(
        island,
        mode.choices.filter((x) => !used.has(nameKey(x.name))),
        seededRng(seed, q + 1),
      );
      for (const c of choices) used.add(nameKey(c.name));
      const status = `${q + 1} / ${questions.length} 問目`;
      const showProgress = () => {
        // スマホ幅でもタイトルと1行に収まるよう詰める。区切りを「・」にすると「伊豆・小笠原」と紛れるので空白にする
        progress.textContent = `${q + 1}/${questions.length}問 ${mode.name} 正解 ${answers.filter((a) => a.choice === a.island).length}`;
      };
      showProgress();
      const last = q + 1 >= questions.length;
      const feedback = () => `
          <p class="next"><button class="btn retro" type="button" id="next">${last ? "結果を見る ▶" : "次の問題へ ▶"}</button></p>
          <div id="viewing">${viewing(island)}</div>`;
      panel.innerHTML = `
        <h2 class="prompt" tabindex="-1">太い線で囲まれた島はどれ？<span id="hard" class="hard retro" hidden>難問！</span></h2>
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
        <div id="feedback" class="reserve" aria-hidden="true">${feedback()}</div>`;
      // 地図はパネルの残りの高さに広がるので、パネルを描いてから大きさを測り直して寄せる
      map.resize();
      // 出題時は動かさずに切り替える。移動の向きが場所のヒントになり、途中の経路のタイルまで読み込んでしまうため
      focusIsland(map, island, false, !!mode.fill);
      // 出題の移動より後に出す（移動で消えないように）
      if (q === 0) showPanHint(map);
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
      // 選択肢ではなく問題文に置く（Enter の押しすぎで選択肢1を選ばないように。Tab で選択肢へ進める）
      panel
        .querySelector<HTMLElement>(".prompt")
        ?.focus({ preventScroll: true });
      // 最初の問題では集計がまだ届いていないことがある。そのときは読み上げず、見出しの「難問！」だけで伝える
      const hardNow = isHard(statsNow?.get(island.id));
      announce(
        `${status}。${hardNow ? "難問。" : ""}太い線で囲まれた島はどれ？`,
      );
      // 次の問題へ進んだ後に返ってきても、古い要素に書くだけで害はない（読み上げはしない。問題文の邪魔になるため）
      const rate = $("#rate");
      const hard = $("#hard");
      stats.then((m) => {
        const s = m.get(island.id);
        rate.textContent = formatRate(s);
        hard.hidden = !isHard(s);
      });

      /** 回答後に選択肢を押すと、その島へ移動して詳しく見られる（誤答も学びに使う） */
      const review = (c: Island) => {
        jump(c, mode);
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
        const fb = $("#feedback");
        fb.classList.remove("reserve");
        fb.removeAttribute("aria-hidden");
        fb.innerHTML = feedback();
        record(island, correct);
        const next = $("#next");
        next.addEventListener("click", () => (last ? result() : ask(q + 1)));
        next.focus();
        announce(
          `${correct ? "○ 正解！" : "× 不正解… 正解は "}${island.name}、${describe(island)}`,
        );
      };
    };

    const result = () => {
      const score = answers.filter((a) => a.choice === a.island).length;
      progress.textContent = `結果・${mode.name}`;
      recordPlay(mode.name, score, answers.length);
      hideRecenter(map);
      // 「難易度を選ぶ」ボタンと役割が重なるので出さない
      home.hidden = true;
      // 相手の ○× があれば列を足して1問ずつ比べる（問題の数が違えば出さない）
      const theirs =
        rival?.results?.length === answers.length ? rival.results : undefined;
      // 島名を押すと、その島へ地図を移す
      const shown: Island[] = [];
      const show = (x: Island) =>
        `<button class="link-btn" type="button" data-show="${shown.push(x) - 1}">${esc(x.name)}</button>`;
      panel.innerHTML = `
        <h2 tabindex="-1" id="result">${score} / ${answers.length} 問正解</h2>
        ${rival === undefined ? "" : `<p class="versus retro">挑戦相手 ${rival.score} 問・あなた ${score} 問　${versus(score, rival.score)}</p>`}
        <p class="row">
          <button class="btn retro" type="button" id="share">${canShare ? "結果をシェア" : "結果をコピー"}</button>
          <span class="caption">同じ${answers.length}問に挑戦できるリンクが付きます。</span>
        </p>
        <div class="table-wrap">
          <table class="result-table">
            <thead>
              <tr>
                <th scope="col">問</th>
                <th scope="col">結果</th>
                <th scope="col">正解</th>
                <th scope="col">都道府県</th>
                <th scope="col">回答</th>
                ${theirs ? `<th scope="col">相手</th>` : ""}
              </tr>
            </thead>
            <tbody>
              ${answers
                .map((a, i) => {
                  const ok = a.choice === a.island;
                  // 自分だけ正解した問題は、どこで差をつけたか分かるよう判子で示す
                  const won = ok && theirs?.[i] === false;
                  return `<tr class="result--${ok ? "correct" : "wrong"}">
                    <td>${i + 1}</td>
                    <td class="result__mark">${ok ? "○ 正解" : "× 不正解"}${won ? `<span class="hard won">勝ち</span>` : ""}</td>
                    <th scope="row">${show(a.island)}</th>
                    <td>${esc(a.island.prefs.join("・"))}</td>
                    <td>${show(a.choice)}</td>
                    ${theirs ? `<td class="result__rival${ok !== theirs[i] ? ` result--${theirs[i] ? "correct" : "wrong"}` : ""}">${theirs[i] ? "○" : "×"}</td>` : ""}
                  </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
        <p class="caption">島の名前を押すと、その島を地図で確かめられます。</p>
        <p class="row">
          <button class="btn retro" type="button" id="again">もう一度（${esc(mode.name)}）</button>
          <button class="btn retro" type="button" id="back">難易度を選ぶ</button>
        </p>`;
      for (const b of panel.querySelectorAll<HTMLButtonElement>(
        "[data-show]",
      )) {
        b.addEventListener("click", () => {
          const x = shown[Number(b.dataset.show)];
          showIsland(
            map,
            x,
            questionBounds(x.bbox, () => 0.5),
            !reduceMotion.matches,
          );
          // スマホでは表を下へ読み進めると地図が画面の外に出ているので戻す
          mapEl.scrollIntoView({
            behavior: reduceMotion.matches ? "auto" : "smooth",
            block: "nearest",
          });
          announce(`地図に表示中: ${x.name}（${describe(x)}）`);
        });
      }
      const results = answers.map((a) => a.choice === a.island);
      const text = shareText(mode, results, rival?.score);
      const url = shareUrl(location.href, mode, results, seed);
      $("#share").addEventListener("click", async () => {
        if (canShare) {
          // 共有画面を閉じたとき（AbortError）も含めて、失敗は知らせない
          await navigator.share({ text, url }).catch(() => {});
          return;
        }
        try {
          await navigator.clipboard.writeText(`${text}\n${url}`);
          announce("結果とリンクをコピーしました");
          const b = $("#share");
          b.textContent = "コピーしました";
          // もう一度押せることが分かるよう、元に戻す
          setTimeout(() => {
            b.textContent = "結果をコピー";
          }, 2000);
        } catch {
          announce("コピーできませんでした");
        }
      });
      $("#again").addEventListener("click", () => play(mode));
      $("#back").addEventListener("click", start);
      appendInstallHint(panel);
      $("#result").focus();
      announce(
        `結果は ${answers.length} 問中 ${score} 問正解です${rival === undefined ? "" : `。挑戦相手は ${rival.score} 問。${versus(score, rival.score)}`}`,
      );
    };

    ask(0);
  }

  // 読み込み直さずに最初の画面へ戻す。途中までの回答は送信済みなので、確認はしない
  home.addEventListener("click", (e) => {
    e.preventDefault();
    start();
  });
  const c = parseChallenge(location.search);
  const cm = c && modes.find((m) => m.id === c.mode.id);
  if (c && cm) challenge(c, cm);
  else start();
}

// 数字キー 1〜9 で、パネル内の対応するボタンを押す
document.addEventListener("keydown", (e) => {
  // 押しっぱなしの連続入力は無視する（難易度を選んだキーがそのまま1問目の回答にならないように）
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key))
    return;
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
