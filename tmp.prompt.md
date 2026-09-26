# 継続用プロンプト: 日本の島クイズ フェーズ5（地形表現）

CLAUDE.md を読んで要件と決定事項を把握してから、フェーズ5に入ってください。
フェーズ1〜4は完了してコミット済みです（白地図モードで10問遊べる状態）。

## フェーズ5でやること（CLAUDE.md「地形表現」より）
- 国土地理院の標高タイル（DEM）から、陰影（MapLibre の hillshade レイヤー）と等高線（maplibre-contour 等でクライアント生成）を追加する
- 地理院 DEM は独自エンコーディング。**実装前に、現在の URL・形式・利用規約（出典表示）を公式情報で確認する**
- 決定事項: 等高線は DEM からクライアント生成。ただしフェーズ5で地理院ベクタタイルの等高線案と比較して、結果を見せてから最終確定する
- 「白地図」と「等高線あり」を切り替えられるようにする（スタイルガイドの `.segmented` を使う想定）
- 陸・海岸線・ハイライトは OSM のまま。地理院の海岸線は重ねない
- 地理院タイルの出典を表示する
- 配色トークン（`src/styles/tokens.css`）には、等高線（`--c-contour`）と段彩（`--c-land-2`〜`--c-land-4`）が定義済み。段彩の採否も検討する
- 陰影と等高線を重ねても、出題中の島のハイライト（黄色の塗り＋赤い太線）が埋もれないこと

進め方: 実装方針（等高線の生成方法の比較を含む）を先に提示して承認を得る。フェーズの終わりに、成果物と確認してほしい点を報告して止まる。

## 実行環境の制約（重要）
- Claude の Bash は Linux コンテナで動くが、`node_modules` はユーザーの macOS で入れたもの。そのため **Vite・Vitest・Biome・tsc（TypeScript 7 はネイティブバイナリ）はこちらでは動かない**。`pnpm test` / `lint` / `format` / `build` / `dev` はユーザーに実行してもらう
- 純粋な JS のパッケージ（turf, pmtiles など）は `node` で直接動かせる（Node 24 は .ts の型を剥がして直接実行できる）
- osmium / ogr2ogr / tippecanoe はこちらにない。`pnpm data` はユーザーが実行する
- ユーザーが起動した開発サーバーには、こちらから `curl -H "Host: localhost:5173" http://host.orb.internal:5173/...` で届く（Host ヘッダーがないと 403）
- パッケージの追加はユーザーに `pnpm add ...` を依頼する（minimumReleaseAge 30日が設定済み）
- コードを書いたあとは `pnpm format` が必要になることが多い（Biome の行幅は 80）

## これまでの知見
- **MapLibre GL JS は v6.6.0**。v6 は Worker を `import.meta.url` 基準で読み込むため、Vite の事前バンドルで 404 になり、エラーなしで止まる。`src/map.ts` で `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` を `setWorkerUrl` に渡して回避済み。v5 の知識のまま書かず、`node_modules/maplibre-gl/src` を確認すること（hillshade の DEM エンコーディング指定、`addProtocol` などの API も同様）
- pmtiles は v4.5.0、Vite は v8、Vitest は v4、TypeScript は v7
- PMTiles は z3〜z12。レイヤーは land / water / islands（islands は出題対象の島のみ、`id` 属性あり）
- 地図スタイルは `src/map.ts` の `style()` で自前構築。色は CSS 変数から読む。地名ラベルは一切出さない
- 地図の minZoom は 3、maxZoom は 16
- 北方領土と竹島（島根県）は Geofabrik の抽出に含まれないのでデータにない（ユーザーの判断で追加取得しない）

## 主なファイル
- `src/map.ts`: 地図の作成・スタイル・出題中の島のハイライト・極小の島のマーカー
- `src/main.ts`: 画面の流れ（難易度選択 → 10問 → 結果表）、回答後に選択肢を押すとその島を表示
- `src/quiz/`: 出題・選択肢・ズームの純粋関数とテスト
- `src/styles/`: tokens.css（配色）、base.css（共通部品）、app.css（クイズ画面）、contrast.ts（コントラスト検証の組み合わせ。テストあり）
- `styleguide.html`: スタイルガイド（開発サーバーの /styleguide.html）
- `scripts/data/`: データ生成パイプライン（`pnpm data`）、`config/difficulty.json`

## フェーズ6に持ち越し中のメモ
- UI の細部（文言・配置・結果画面）のフィードバックは、フェーズ6でまとめて対応する方針
- DotGothic16 は今 Google Fonts から読み込んでいる。自前で配信するかはフェーズ6で決める
- tippecanoe の設定（ズームごとの簡略化・間引き）は未調整
- 回答後に誤答の島へ移動したとき、正解の島も同時に表示するかは未確認
