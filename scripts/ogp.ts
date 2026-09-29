/**
 * 結果のシェア用の OGP 画像を、モード × 得点（0〜出題数）ごとに public/ogp/{モード}/{得点}.png へ作る。
 * scripts/ogp.html を headless Chrome で撮る（フォントは Google Fonts から読むのでネット接続が必要）。
 * モードと出題数は config から読むので、モードを足したり出題数を変えたりしたら作り直すだけでよい。
 *
 *   pnpm ogp
 *
 * Chrome は既定でインストール済みの Google Chrome を使う。別のものを使うときは CHROME_PATH で実行ファイルを指定する
 */
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { MODE_DEFS } from "../src/quiz/mode-defs.ts";
import { ogpPath } from "../src/quiz/share.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public");

const proxy = process.env.HTTPS_PROXY;
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
  // Chrome は HTTPS_PROXY を見ないので渡す（プロキシの内側で動かすとき）
  ...(proxy ? { proxy: { server: proxy } } : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
  });
  // 消したモード・減らした得点の画像が残らないよう作り直す
  await rm(join(out, "ogp"), { recursive: true, force: true });
  for (const mode of MODE_DEFS) {
    for (let score = 0; score <= mode.count; score++) {
      const url = pathToFileURL(join(root, "scripts/ogp.html"));
      url.search = new URLSearchParams({
        mode: mode.name,
        score: String(score),
        count: String(mode.count),
      }).toString();
      await page.goto(url.toString(), { waitUntil: "networkidle" });
      // フォントが読めないまま撮ると、レトロな字にならない。
      // document.fonts.check は @font-face がない（CSS を読めなかった）ときも true を返すので、読み込めた字体があるかで確かめる
      const loaded = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some(
          (f) => f.family.includes("DotGothic16") && f.status === "loaded",
        );
      });
      if (!loaded) throw new Error("DotGothic16 を読み込めませんでした");
      const file = join(out, ogpPath(mode.id, score));
      await mkdir(dirname(file), { recursive: true });
      await page.screenshot({ path: file });
    }
    console.log(`${mode.name}: ${mode.count + 1} 枚`);
  }
} finally {
  await browser.close();
}
