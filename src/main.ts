import "./styles/base.css";
import "./styles/app.css";
import config from "../config/difficulty.json";
import type { Island } from "../scripts/data/pipeline.ts";
import { createMap, showIsland } from "./map.ts";
import { countNames, displayName, pickChoices } from "./quiz/choices.ts";
import { pickQuestions } from "./quiz/game.ts";
import { questionBounds } from "./quiz/zoom.ts";

const QUESTIONS = 10;
const BANDS = config.bands.map((b) => b.name);

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;
const panel = $("#panel");
const progress = $("#progress");
const live = $("#live");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

const settings = { sound: false };

type Answer = { island: Island; choice: Island };

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

// ---- 効果音（「ピンポーン」。最初は OFF） ----

let audio: AudioContext | undefined;
function chime() {
  audio ??= new AudioContext();
  const t0 = audio.currentTime;
  for (const [freq, at] of [
    [988, 0],
    [784, 0.2],
  ]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + at + 0.6);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.6);
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
  } catch (e) {
    panel.innerHTML = `<p class="feedback feedback--wrong" role="alert">× データを読み込めませんでした（${esc(String(e))}）</p>`;
    return;
  }
  const nameCounts = countNames(islands);

  function start() {
    progress.textContent = "";
    panel.innerHTML = `
      <h2>難易度を選んでください</h2>
      <ul class="choices">
        ${BANDS.map(
          (name, i) => `
          <li><button class="btn choice" type="button" data-key="${i + 1}" data-band="${i}">
            <kbd>${i + 1}</kbd>${esc(name)}
            <span class="mark">${islands.filter((x) => x.band === i).length.toLocaleString("ja-JP")}島</span>
          </button></li>`,
        ).join("")}
      </ul>
      <p><label class="check"><input type="checkbox" id="sound" ${settings.sound ? "checked" : ""} />正解の効果音（ピンポーン）を鳴らす</label></p>
      <p class="caption">数字キー 1〜4 でも選べます。</p>`;
    $("#sound").addEventListener("change", (e) => {
      settings.sound = (e.target as HTMLInputElement).checked;
    });
    for (const b of panel.querySelectorAll<HTMLButtonElement>("[data-band]")) {
      b.addEventListener("click", () => play(Number(b.dataset.band)));
    }
    panel.querySelector<HTMLButtonElement>("[data-band]")?.focus();
  }

  function play(band: number) {
    const questions = pickQuestions(islands, band, QUESTIONS, Math.random);
    const answers: Answer[] = [];

    const ask = (q: number) => {
      const island = questions[q];
      const choices = pickChoices(island, islands, Math.random);
      const status = `${q + 1} / ${questions.length} 問目`;
      progress.textContent = `${status}・${BANDS[band]}・正解 ${answers.filter((a) => a.choice === a.island).length}`;
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
              <kbd>${i + 1}</kbd><span>${esc(displayName(c, nameCounts))}</span>
            </button></li>`,
            )
            .join("")}
        </ul>
        <div id="feedback"></div>`;
      const buttons = [
        ...panel.querySelectorAll<HTMLButtonElement>("[data-index]"),
      ];
      for (const b of buttons) {
        b.addEventListener("click", () => {
          if (b.getAttribute("aria-disabled") === "true") return;
          answer(choices[Number(b.dataset.index)]);
        });
      }
      buttons[0]?.focus();
      announce(`${status}。太い線で囲まれた島はどれ？`);

      const answer = (choice: Island) => {
        answers.push({ island, choice });
        const correct = choice === island;
        buttons.forEach((b, i) => {
          b.setAttribute("aria-disabled", "true");
          b.removeAttribute("data-key");
          const c = choices[i];
          const mark =
            c === island ? "○ 正解" : c === choice ? "× あなたの答え" : "";
          if (!mark) return;
          b.dataset.result = c === island ? "correct" : "wrong";
          b.insertAdjacentHTML(
            "beforeend",
            `<span class="mark">${mark}</span>`,
          );
        });
        const name = displayName(island, nameCounts);
        const head = correct ? "○ 正解！" : `× 不正解… 正解は ${name}`;
        const detail = [
          island.yomi && `読み: ${island.yomi}`,
          island.pref,
          `面積 ${formatArea(island.areaKm2)}`,
          island.population &&
            `人口 ${island.population.toLocaleString("ja-JP")}人`,
        ]
          .filter(Boolean)
          .join("・");
        const last = q + 1 >= questions.length;
        $("#feedback").innerHTML = `
          <p class="feedback feedback--${correct ? "correct" : "wrong"}">${esc(head)}</p>
          <p>${esc(name)}（${esc(detail)}）</p>
          <p class="next"><button class="btn" type="button" id="next">${last ? "結果を見る ▶" : "次の問題へ ▶"}</button></p>`;
        const next = $("#next");
        next.addEventListener("click", () => (last ? result() : ask(q + 1)));
        next.focus();
        announce(`${head}。${name}、${detail}`);
        if (correct && settings.sound) chime();
      };
    };

    const result = () => {
      const score = answers.filter((a) => a.choice === a.island).length;
      progress.textContent = `結果・${BANDS[band]}`;
      panel.innerHTML = `
        <h2 tabindex="-1" id="result">${score} / ${answers.length} 問正解</h2>
        <ol class="result-list">
          ${answers
            .map((a) => {
              const ok = a.choice === a.island;
              return `<li>${ok ? "○" : "×"} ${esc(displayName(a.island, nameCounts))}${
                ok
                  ? ""
                  : `（あなたの答え: ${esc(displayName(a.choice, nameCounts))}）`
              }</li>`;
            })
            .join("")}
        </ol>
        <p class="row">
          <button class="btn" type="button" id="again">もう一度（${esc(BANDS[band])}）</button>
          <button class="btn" type="button" id="back">難易度を選ぶ</button>
        </p>`;
      $("#again").addEventListener("click", () => play(band));
      $("#back").addEventListener("click", start);
      $("#result").focus();
      announce(`結果は ${answers.length} 問中 ${score} 問正解です`);
    };

    ask(0);
  }

  start();
}

// 数字キー 1〜4 で、パネル内の対応するボタンを押す
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
