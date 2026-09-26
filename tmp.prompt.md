# 継続用プロンプト: 日本の島クイズ フェーズ6（仕上げ）

CLAUDE.md を読んで要件と決定事項を把握してから、作業に入ってください。
フェーズ1〜5は完了しています（常に陰影・等高線ありの地図で10問遊べる状態）。

## 状況（2026-09-26 時点）
- 等高線は地理院の最適化ベクトルタイル（PMTiles、`Cntr` レイヤー、z9〜）、陰影は地理院 DEM を `gsidem://` で terrarium に変換して hillshade。どちらも地図の load 後に `addTerrain()` で追加（読めなくてもクイズは続く）
- 回答後に Wikipedia（`islands.json` の `wikipedia` に記事名。日本語版に記事がある島のみ）と Google マップ（代表点の座標）のリンクを出す
- 結果表の島名を押すとその島へ地図が移動する
- `window.__map` で MapLibre の Map を露出（デバッグ用、本番でも可とユーザー確認済み）
- README のクレジット・ライセンスは整理済み。`vite.config.ts` の `build.license` で `dist/licenses.md` を出力
- `pnpm data` は取得済みの OSM PBF を使い続ける（消したときだけ再取得）
- OGP・アイコンはユーザーが別途進めている（`tmp.ogp.prompt.md` で別の Claude にスクショを依頼）

## 残課題（ユーザーと相談して優先順を決める）
- **出題時のズーム**: `questionBounds` の `minContextKm = 40` のため、スマホでは出題時にほぼ z8.5 になり、z9 からの等高線がほとんど見えない。minZoom（=5、データ範囲の端を見せないためのもの）とは別の話。ユーザーは「別タスクで考える」と保留中
- 使い勝手の作り込み（文言・配置・結果画面）。誤答の島へ移動したとき正解の島も同時に表示するか
- スマホ対応とアクセシビリティの確認（CLAUDE.md「必ず守ること」の検証。陰影を重ねた陸の上で赤い輪郭のコントラスト 3:1 を保てているか）
- パフォーマンス: tippecanoe の設定（ズームごとの簡略化・間引き）が未調整。`base.pmtiles` は 30MB（Range リクエストで部分取得なので初回に全部は落とさない）
- DotGothic16 の自前配信（OFL なので可。サブセット化するなら意味がある）
- OGP・favicon の組み込み（素材はユーザーが用意中）
- デプロイ: GitHub Pages（Range リクエスト対応を確認済み。PMTiles 30MB は同梱可）。base path と Actions のワークフロー。PMTiles の扱い（Release asset から取り込むか等）はユーザーと相談

## 実行環境の制約（重要）
- Claude の Bash は Linux コンテナで動くが、`node_modules` はユーザーの macOS で入れたもの。そのため **Vite・Vitest・Biome・tsc はこちらでは動かない**。`pnpm test` / `lint` / `format` / `build` / `dev` はユーザーに実行してもらう
- 純粋な JS のパッケージや src の純粋関数は `node` で直接動かせる（Node 24 は .ts の型を剥がして直接実行できる）
- osmium / ogr2ogr / tippecanoe はこちらにない。`pnpm data` はユーザーが実行する
- ユーザーが起動した開発サーバーには `curl -H "Host: localhost:5173" http://host.orb.internal:5173/...` で届く
- パッケージの追加はユーザーに `pnpm add ...` を依頼する（minimumReleaseAge 30日）
- コードを書いたあとは `pnpm format` が必要になることが多い（Biome の行幅は 80）
- MapLibre GL JS は v6.6.0。v5 の知識で書かず `node_modules/maplibre-gl/src` を確認する
