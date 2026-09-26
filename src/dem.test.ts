import { describe, expect, it } from "vitest";
import { gsiToTerrarium } from "./dem.ts";

/** 地理院形式の1画素を変換し、terrarium の式で標高に戻す */
function roundTrip(r: number, g: number, b: number): number {
  const px = new Uint8ClampedArray([r, g, b, 255]);
  gsiToTerrarium(px);
  return px[0] * 256 + px[1] + px[2] / 256 - 32768;
}

describe("gsiToTerrarium", () => {
  it("正の標高", () => {
    // 3776.24m = 377624 = 0x05_C3_18
    expect(roundTrip(0x05, 0xc3, 0x18)).toBeCloseTo(3776.24, 2);
    expect(roundTrip(0, 0, 0)).toBe(0);
  });

  it("負の標高は 24bit の2の補数", () => {
    // -1.5m = 2^24 - 150
    expect(roundTrip(0xff, 0xff, 0x6a)).toBeCloseTo(-1.5, 2);
  });

  it("無効値 (128, 0, 0) は 0m", () => {
    expect(roundTrip(128, 0, 0)).toBe(0);
  });
});
