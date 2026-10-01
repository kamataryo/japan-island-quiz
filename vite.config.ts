import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { sharePages } from "./scripts/share-pages.ts";

export default defineConfig(({ command }) => ({
  // GitHub Pages ではリポジトリ名の下（/japan-island-quiz/）に置かれるので、相対パスにする
  base: "./",
  plugins: [
    // 結果のシェア用のページ（モード × 得点ごと）
    sharePages(),
    // dev だけ Worker（集計 API）を Vite の中で動かす。build に効かせると dist の構成が変わるので、ビルドとデプロイは wrangler のまま。
    // Vitest も serve で設定を読むので外す。
    // minimumReleaseAge で workerd が1か月ほど古いので、wrangler.jsonc の compatibility_date に対応していない。dev だけ対応する日付に下げる
    ...(command === "serve" && !process.env.VITEST
      ? [cloudflare({ config: { compatibility_date: "2026-09-04" } })]
      : []),
  ],
  build: {
    // 同梱した依存のライセンス全文を配布物に含める
    license: { fileName: "licenses.md" },
    // 出題範囲の確認ページ（debug.html）も公開する。styleguide.html は開発時だけ
    rolldownOptions: { input: ["index.html", "debug.html"] },
  },
}));
