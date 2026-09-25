import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, PAIRS } from "./contrast.ts";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const tokens = Object.fromEntries(
  [...css.matchAll(/--c-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [
    m[1],
    m[2],
  ]),
);

describe("contrastRatio", () => {
  it("白と黒は 21:1", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21);
  });
});

describe("tokens.css のコントラスト", () => {
  it.each(PAIRS)("$use ($fg / $bg) が $min:1 以上", ({ fg, bg, min }) => {
    expect(tokens[fg], fg).toBeDefined();
    expect(tokens[bg], bg).toBeDefined();
    expect(contrastRatio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min);
  });
});
