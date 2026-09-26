import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages ではリポジトリ名の下（/japan-island-quiz/）に置かれるので、相対パスにする
  base: "./",
  // 同梱した依存のライセンス全文を配布物に含める
  build: { license: { fileName: "licenses.md" } },
});
