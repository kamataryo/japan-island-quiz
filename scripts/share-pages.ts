/**
 * 結果のシェア用のページ（s/{モード}/{得点}/index.html）をビルド時に作る Vite プラグイン。
 * SNS のリンクプレビューは JavaScript を動かさないので、得点ごとの OGP 画像は静的な HTML の meta で示す必要がある。
 * ページは開くとすぐトップページの挑戦画面（?mode=&score=&seed=）へ移る。
 * モードと得点の上限は config から読むので、モードを足したり出題数を変えたりしても作り直すだけでよい
 */
import type { Plugin } from "vite";
import { MODE_DEFS, type ModeDef } from "../src/quiz/mode-defs.ts";
import { ogpPath, SITE_URL, scoreTitle, sharePath } from "../src/quiz/share.ts";

const esc = (s: string | number) =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function sharePage(mode: ModeDef, score: number): string {
  const title = scoreTitle(mode, score, mode.count);
  const description = `同じ${mode.count}問に挑戦してみよう。地図を見て、ハイライトされた島の名前を4択で当てるクイズ。`;
  const image = new URL(ogpPath(mode.id, score), SITE_URL).toString();
  // s/{モード}/{得点}/ からサイトの根へ。シードはシェアした URL の ?seed= をそのまま渡す
  const top = "../../../";
  const params = `mode=${encodeURIComponent(mode.id)}&score=${score}`;
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="日本の島クイズ" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(`島の地図に「${mode.name}」${mode.count}問中${score}問正解の結果`)}" />
    <meta property="og:locale" content="ja_JP" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="robots" content="noindex" />
    <script>
      location.replace("${top}?${params}&" + location.search.slice(1));
    </script>
  </head>
  <body>
    <p><a href="${top}?${params}">日本の島クイズで同じ問題に挑戦する</a></p>
  </body>
</html>
`;
}

export function sharePages(): Plugin {
  return {
    name: "share-pages",
    apply: "build",
    generateBundle() {
      for (const mode of MODE_DEFS) {
        for (let score = 0; score <= mode.count; score++) {
          this.emitFile({
            type: "asset",
            fileName: `${sharePath(mode.id, score)}index.html`,
            source: sharePage(mode, score),
          });
        }
      }
    },
  };
}
