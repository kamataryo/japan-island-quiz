import { describe, expect, it } from "vitest";
import islands from "../public/data/islands.json";
import { parseAnswer, parseIds } from "./index.ts";

describe("parseAnswer", () => {
  const id = islands[0].id;

  it("実在する島の回答を受け付ける", () => {
    expect(parseAnswer({ id, correct: true })).toEqual({ id, correct: true });
  });

  it("実在しない島・型の違う値・JSON でないものは弾く", () => {
    expect(parseAnswer({ id: "w0", correct: true })).toBeUndefined();
    expect(parseAnswer({ id, correct: "true" })).toBeUndefined();
    expect(parseAnswer(null)).toBeUndefined();
    expect(parseAnswer(undefined)).toBeUndefined();
  });
});

describe("parseIds", () => {
  const ids = islands.slice(0, 10).map((x) => x.id);

  it("1ゲーム分の実在する島を受け付ける", () => {
    expect(parseIds(ids.join(","))).toEqual(ids);
  });

  it("空・多すぎる・実在しない島を含むものは弾く", () => {
    expect(parseIds(null)).toBeUndefined();
    expect(parseIds("")).toBeUndefined();
    expect(parseIds([...ids, islands[10].id].join(","))).toBeUndefined();
    expect(parseIds(`${ids[0]},w0`)).toBeUndefined();
  });
});
