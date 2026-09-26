import { describe, expect, it } from "vitest";
import islands from "../public/data/islands.json";
import { parseAnswer } from "./index.ts";

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
