import { defineConfig } from "vite";

export default defineConfig({
  // 同梱した依存のライセンス全文を配布物に含める
  build: { license: { fileName: "licenses.md" } },
});
