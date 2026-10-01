import { describe, expect, it } from "vitest";
import islands from "../../public/data/islands.json";
import type { Island } from "../../scripts/data/pipeline.ts";
import { sharePage } from "../../scripts/share-pages.ts";
import { pickChoices } from "./choices.ts";
import { formatSeed, parseSeed, pickQuestions, seededRng } from "./game.ts";
import { MODE_DEFS, modeById, modeDef, modeLabel } from "./mode-defs.ts";
import { buildModes } from "./modes.ts";
import { parseChallenge, shareText, shareUrl, versus } from "./share.ts";

const take = (rng: () => number, n = 5) => Array.from({ length: n }, rng);

describe("seededRng", () => {
  it("同じシード・同じ列なら同じ値を返す", () => {
    expect(take(seededRng(42, 3))).toEqual(take(seededRng(42, 3)));
  });

  it("シードか列が違えば別の値になる", () => {
    expect(take(seededRng(42))).not.toEqual(take(seededRng(43)));
    expect(take(seededRng(42, 1))).not.toEqual(take(seededRng(42, 2)));
  });

  it("0 以上 1 未満", () => {
    for (const x of take(seededRng(2 ** 32 - 1), 1000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("シード", () => {
  it("URL の文字列と行き来できる", () => {
    for (const s of [0, 1, 123456789, 2 ** 32 - 1])
      expect(parseSeed(formatSeed(s))).toBe(s);
  });

  it("36進数でないもの・32bit を超えるものは読まない", () => {
    expect(parseSeed(null)).toBeUndefined();
    expect(parseSeed("")).toBeUndefined();
    expect(parseSeed("ABC")).toBeUndefined();
    expect(parseSeed("-1")).toBeUndefined();
    expect(parseSeed("zzzzzzz")).toBeUndefined();
  });
});

describe("同じシードで同じゲームになる", () => {
  const { bands, areas } = buildModes(islands as Island[]);
  it.each([...bands, ...areas])("$name", (mode) => {
    const game = (seed: number) =>
      pickQuestions(mode.questions, mode.count, seededRng(seed), mode.weight)
        .map((x, q) => [
          x.id,
          ...pickChoices(x, mode.choices, seededRng(seed, q + 1)).map(
            (c) => c.id,
          ),
        ])
        .join();
    expect(game(12345)).toBe(game(12345));
    expect(game(12345)).not.toBe(game(54321));
  });
});

describe("モードの定義", () => {
  it("id は URL とファイル名に使える文字だけで、重複しない", () => {
    const ids = MODE_DEFS.map((m) => m.id);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("名前は重複しない（集計のキーなので）", () => {
    const names = MODE_DEFS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("出題数は config で変えられ、なければ10問", () => {
    expect(modeDef({ id: "a", name: "A" }, "band").count).toBe(10);
    expect(modeDef({ id: "a", name: "A", questions: 20 }, "band").count).toBe(
      20,
    );
  });

  it("結果に出すモード名には、難易度か地域かを添える", () => {
    expect(modeLabel(MODE_DEFS[0])).toMatch(/^難易度：/);
    expect(modeLabel(MODE_DEFS[MODE_DEFS.length - 1])).toMatch(/^地域：/);
    expect(modeLabel(modeDef({ id: "a", name: "瀬戸内" }, "region"))).toBe(
      "地域：瀬戸内",
    );
  });
});

const hard = modeById("hard");
if (!hard) throw new Error("むずい がない");

describe("shareText", () => {
  it("モード・得点と ○× を5問ごとに区切って並べ、ハッシュタグを付ける。島名は入れない", () => {
    const r = [true, true, false, true, true, true, false, true, true, false];
    expect(shareText(hard, r)).toBe(
      "日本の島クイズ【むずい】10問中7問正解\n○○×○○ ○×○○×\n#日本の島クイズ",
    );
  });

  it("出題数が5の倍数でなくてもよい", () => {
    expect(shareText(hard, [true, false, true]).split("\n")[1]).toBe("○×○");
  });

  it("挑戦の結果は勝敗の行を足す", () => {
    const r = [true, true, false, true, true];
    expect(shareText(hard, r, 3).split("\n")[1]).toBe(
      "3問正解の挑戦に4問正解で勝利！",
    );
    expect(shareText(hard, r, 4).split("\n")[1]).toBe(
      "4問正解の挑戦に4問正解で引き分け",
    );
    expect(shareText(hard, r, 5).split("\n")[1]).toBe(
      "5問正解の挑戦に4問正解で敗北…",
    );
  });
});

describe("shareUrl と parseChallenge", () => {
  const r = [true, true, false, true, true, true, false, true, true, false];

  it("シェアの URL はモード・得点ごとのページにシードと ○× を付ける", () => {
    expect(shareUrl("https://example.com/?mode=x", hard, r, 1295)).toBe(
      "https://example.com/s/hard/7/?seed=zz&r=1101110110",
    );
  });

  it("シェアのページから移ったトップページの URL を読む", () => {
    expect(parseChallenge("?mode=hard&score=7&seed=zz&r=1101110110")).toEqual({
      mode: hard,
      seed: 1295,
      score: 7,
      results: r,
    });
  });

  it("○× は出題数・得点と合わなければ使わない", () => {
    for (const x of [
      "",
      "110111011",
      "11011101101",
      "1111110110",
      "11a1110110",
    ])
      expect(
        parseChallenge(`?mode=hard&score=7&seed=zz&r=${x}`)?.results,
      ).toBeUndefined();
  });

  it("得点が読めなくても、モードとシードがあれば挑戦できる", () => {
    expect(parseChallenge("?mode=hard&seed=zz")?.score).toBeUndefined();
    expect(
      parseChallenge("?mode=hard&score=11&seed=zz")?.score,
    ).toBeUndefined();
    expect(parseChallenge("?mode=hard&score=x&seed=zz")?.score).toBeUndefined();
  });

  it("モードかシードが読めなければ挑戦ではない", () => {
    expect(parseChallenge("")).toBeUndefined();
    expect(parseChallenge("?mode=nope&seed=zz")).toBeUndefined();
    expect(parseChallenge("?mode=hard&seed=")).toBeUndefined();
  });
});

describe("sharePage", () => {
  const html = sharePage(hard, 7);

  it("得点ごとの OGP 画像を絶対 URL で示す", () => {
    expect(html).toContain(
      '<meta property="og:image" content="https://japan-island-quiz.kamataryo.workers.dev/ogp/hard/7.png" />',
    );
    expect(html).toContain("日本の島クイズ【むずい】10問中7問正解");
  });

  it("開くとトップページの挑戦画面へ移る（シードはシェアの URL から引き継ぐ）", () => {
    expect(html).toContain(
      'location.replace("../../../?mode=hard&score=7&" + location.search.slice(1));',
    );
  });
});

describe("versus", () => {
  it("相手の得点と比べる", () => {
    expect(versus(8, 7)).toBe("あなたの勝ち！");
    expect(versus(7, 7)).toBe("引き分け");
    expect(versus(6, 7)).toBe("挑戦相手の勝ち");
  });
});
