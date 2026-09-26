import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages ではリポジトリ名の下（/japan-island-quiz/）に置かれるので、相対パスにする
  base: "./",
  build: {
    // 同梱した依存のライセンス全文を配布物に含める
    license: { fileName: "licenses.md" },
    // 出題範囲の確認ページ（debug.html）も公開する。styleguide.html は開発時だけ
    rolldownOptions: { input: ["index.html", "debug.html"] },
  },
});
