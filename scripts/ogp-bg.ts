/**
 * 地域モードの OGP 画像の背景を scripts/ogp-bg/{モード id}.png に作る（リポジトリに入れる）。
 * 開発サーバーで scripts/ogp-bg.html を開いて撮るので、先に `pnpm dev` を動かしておく。
 * 背景のないモードは public/ogp.png（利尻島）を使う（scripts/ogp.ts）。
 *
 *   pnpm ogp:bg [開発サーバーの URL（既定 http://localhost:5173）]
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

/** モード id → その地域を象徴する島の id と、ogp-bg.html に渡す他のパラメーター */
const ISLANDS: Record<string, string> = {
  setouchi: "r4671549", // 小豆島
  ryukyu: "r4858188", // 西表島
  // 青ヶ島。隣の八丈島まで 60km あり周りが海だけで寂しいので、島を大きく描く
  "izu-ogasawara": "w130973103&pad=50",
};

const out = join(dirname(fileURLToPath(import.meta.url)), "ogp-bg");
const server = process.argv[2] ?? "http://localhost:5173";

const browser = await chromium.launch(
  process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" },
);
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
  });
  await mkdir(out, { recursive: true });
  for (const [mode, query] of Object.entries(ISLANDS)) {
    await page.goto(`${server}/scripts/ogp-bg.html?id=${query}`);
    await page.waitForFunction(() => "__ready" in window, null, {
      timeout: 60_000,
    });
    await page.screenshot({ path: join(out, `${mode}.png`) });
    console.log(`${mode}: ${query}`);
  }
} finally {
  await browser.close();
}
