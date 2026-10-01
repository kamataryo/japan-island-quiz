# 日本の島クイズ

地形だけが描かれた地図を見て、ハイライトされた島の名前を4択で当てるクイズです。

## 開発

必要なもの: Node.js 22 以上、pnpm 10.16 以上（`minimumReleaseAge` に対応したバージョン）

```sh
pnpm install
pnpm dev      # 開発サーバー
pnpm test     # ユニットテスト (Vitest)
pnpm lint     # lint + フォーマットチェック (Biome)
pnpm format   # 自動修正
pnpm build    # 型チェック + ビルド
```

`pnpm-workspace.yaml` の `minimumReleaseAge` により、公開から30日経っていないパッケージはインストールされません。

`pnpm dev` では、集計 API の Worker（`worker/index.ts`）も [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/) で一緒に動きます。D1 などはローカルのものに置き換わり、`.wrangler/state/` に保存されます（消せば空に戻る）。初回だけ、D1 のテーブルを作ってください。

```sh
pnpm wrangler d1 migrations apply japan-island-quiz --local
```

## データ生成

島データは OpenStreetMap から作ります（ビルド時に1回だけ実行。クライアントから OSM の API は叩きません）。

必要な CLI: [osmium-tool](https://osmcode.org/osmium-tool/), [GDAL](https://gdal.org/)（ogr2ogr）, [tippecanoe](https://github.com/felt/tippecanoe)

```sh
brew install osmium-tool gdal tippecanoe
pnpm data
```

| 段階 | 入力 | 出力 |
|---|---|---|
| 取得 | [Geofabrik 日本抽出](https://download.geofabrik.de/asia/japan.html)（日付付きファイルに固定）、[osmdata land polygons](https://osmdata.openstreetmap.de/data/land-polygons.html) | `data/cache/`（取得元と日時は `sources.json`） |
| 抽出 | `osmium tags-filter` で place=island/islet・natural=water・admin_level=4（都道府県）・admin_level=7（市区町村） | `data/cache/features-*.geojsonseq`（抽出条件ごと） |
| 陸地 | land polygons を日本周辺で切り抜き（ogr2ogr） | `data/cache/land.geojsonseq` |
| 島の組み立て | way/relation の島はそのまま。node だけの島は、その node を含む陸地ポリゴンを形状にする | |
| 知名度・人口・記事名 | Wikidata SPARQL（sitelinks 数、P1082、日本語版 Wikipedia の記事） | `data/cache/wikidata-v2.json` |
| 難易度 | `config/difficulty.json` の重みと帯の比率 | |
| 出力 | | `public/data/islands.json`, `public/data/meta.json`, `public/data/base.pmtiles`, `data/report.md`（目視確認用） |

- 各段階の成果物は `data/cache/` にキャッシュされます。やり直すときは該当ファイルを消してください
- OSM データ（`data/cache/japan-*.osm.pbf`）は、一度取得したら新しい日付のものが出ても使い続けます。最新にするときはこのファイルを消してください
- 特定の日付の OSM データで再現するには `PBF_URL=https://download.geofabrik.de/asia/japan-YYMMDD.osm.pbf pnpm data`
- 取得日時・取得条件・件数は `public/data/meta.json` に記録されます
- 出題対象外: 名前のない島、本州・北海道・九州・四国、0.001km² 未満の島、国外の島
- 北方領土と竹島（島根県）は Geofabrik の日本抽出（実効支配に沿った範囲）に入らないため、その島だけを Overpass API で一度取得して足しています（`data/cache/extra.osm`、約17MB。クエリは `scripts/data/pipeline.ts` の `EXTRA_QUERY`）。都道府県・市町村は日本政府の立場で付けます（尖閣諸島も同じ。`DISPUTED_AREAS`）

### 難易度の決め方

各島について次の指標を出し、島全体での順位（0〜1）に正規化してから重み付き平均した「易しさスコア」で帯に分けます。

| 指標 | 易しい方向 |
|---|---|
| 面積（対数） | 大きい |
| 知名度（Wikidata の sitelinks 数） | 多い |
| 有人（OSM の population か Wikidata P1082 が 1 以上）。人口データが一部の島にしかなく、大きな有人島が無人扱いになるので重みは 0 | 有人 |
| 形のユニークさ（1 − 凸包充填率 × 凸包の円形度） | 特徴的 |
| 周辺の密集度（半径内にある面積が近い島の数） | 少ない |

## アイコン

`public/favicon.png`（32px）、`public/apple-touch-icon.png`（180px）、`public/icon-192.png`・`public/icon-512.png`（manifest.webmanifest 用。Android でホーム画面に追加したときのアイコン）は `scripts/icon.html` を headless Chrome で撮って作ります（フォントは Google Fonts から読むのでネット接続が必要）。

```sh
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$C" --headless --hide-scrollbars --virtual-time-budget=10000 --window-size=180,180 \
  --screenshot="$PWD/public/apple-touch-icon.png" "file://$PWD/scripts/icon.html#180"
sips -z 32 32 public/apple-touch-icon.png --out public/favicon.png
for s in 192 512; do
  "$C" --headless --hide-scrollbars --virtual-time-budget=10000 --window-size=$s,$s \
    --screenshot="$PWD/public/icon-$s.png" "file://$PWD/scripts/icon.html#$s"
done
```

フォントの読み込みが撮影に間に合わないと字のない水色だけの画像になるので、そのときはもう一度実行してください。

## 結果のシェア

結果画面の「結果をシェア」で、得点と ○× と、同じ問題に挑戦できるリンク（`/s/{モード}/{得点}/?seed=…`）を共有します（Web Share API がなければクリップボードにコピー）。
問題・選択肢・地図の位置はシード（URL の `seed`）から決まるので、リンクを開いた人は同じ問題に挑戦できます。ただし `islands.json` を作り直すと同じシードでも問題が変わります。

- `s/{モード}/{得点}/index.html`: 得点ごとの OGP を持つページ。`pnpm build` で `scripts/share-pages.ts`（Vite プラグイン）が作り、開くとトップページの挑戦画面（`/?mode=&score=&seed=`）へ移る
- `ogp/{モード}/{得点}.png`: 得点ごとの OGP 画像。`scripts/ogp.html` を headless Chrome で撮って作る（フォントは Google Fonts から読むのでネット接続が必要。リポジトリには入れず、デプロイのたびに作る）

```sh
pnpm ogp   # public/ogp/ に作る。インストール済みの Google Chrome を使う（別の Chrome は CHROME_PATH で指定）
```

背景は `public/ogp.png`（利尻島）で、地域モードだけはその地域の島（瀬戸内＝小豆島、琉球弧＝西表島、伊豆・小笠原＝青ヶ島）の背景 `scripts/ogp-bg/{モード}.png` を使います。
背景はリポジトリに入れてあり、島を変えるときだけ、開発サーバー（`pnpm dev`）を動かしたまま `scripts/ogp-bg.html` を撮って作り直します（島は `scripts/ogp-bg.ts` で指定）。

```sh
pnpm ogp:bg   # scripts/ogp-bg/ に作る。開発サーバーの URL が違うときは引数で渡す
```

どちらもモードの `id`（URL に使う）と出題数を `config/difficulty.json`・`config/regions.json` から読むので、モードを足したり出題数（`questions`、既定は10）を変えたりしても作り直すだけで対応します。`id` を変えるとシェア済みのリンクが切れます。

## デプロイ

`main` への push（または Actions の手動実行）で Cloudflare Workers（workers.dev）にデプロイされます（`.github/workflows/deploy.yml`、設定は `wrangler.jsonc`）。
静的ファイルは Workers の静的アセットとして配り、次のものだけ Worker が処理します。

- `/tiles/{版}/{z}/{x}/{y}.mvt`: R2 に置いた `base.pmtiles` からタイルを1枚ずつ返す（静的アセットは Range リクエストに対応していないため）。版は `meta.json` の `pmtilesSha256` の先頭12文字で、データを作り直すと URL が変わるので古いタイルがキャッシュから混ざらない
- `/api/answers`: 島ごとの正答率の集計（D1）
- `/api/plays`・`/api/modes`: モードごとの得点の記録と、トップページに出す「みんなの正答率」（D1）

`base.pmtiles` は大きいのでリポジトリに入れず、`meta.json` に対応する Release（タグ `YYYY-MM-DD-{sha256 の先頭12桁}`）の asset から取って R2 に上げます。asset の sha256 が `meta.json` の `pmtilesSha256` と違うとデプロイは失敗します。

初回だけ、次を行ってください。

- D1 を作り、出力の `database_id` を `wrangler.jsonc` に書く: `pnpm wrangler d1 create japan-island-quiz`
- R2 のバケットを作る: `pnpm wrangler r2 bucket create japan-island-quiz`
- リポジトリの Secrets に `CLOUDFLARE_API_TOKEN`（「Edit Cloudflare Workers」テンプレート + D1 の編集権限）と `CLOUDFLARE_ACCOUNT_ID` を登録する

手元で集計まで試すとき:

```sh
pnpm wrangler d1 migrations apply japan-island-quiz --local
pnpm wrangler r2 object put japan-island-quiz/base.pmtiles --file public/data/base.pmtiles --local
pnpm build && pnpm wrangler dev
```

データを作り直したら、`islands.json` と `base.pmtiles` の組み合わせがずれないよう、push の前に Release を作ります（`islands.json` の島 ID と PMTiles の `id` 属性で出題中の島をハイライトしているため）。

```sh
pnpm data
git commit ...   # public/data/islands.json, meta.json
pnpm release-pmtiles
git push
```

## ライセンス

- ソースコード: [MIT](./LICENSE)
- 生成データ（`public/data/` 以下の OSM 由来データ）: [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)

### OSM 由来データの扱い（ODbL）

- `islands.json` と `base.pmtiles` は OSM から作った「派生データベース」なので ODbL 1.0 で提供します。再配布・改変したものも ODbL で共有する必要があります
- 表示する地図（画像）は「制作物（Produced Work）」にあたり、「© OpenStreetMap contributors」の表示が必要です（画面に常に表示します）
- 知名度・人口に使う Wikidata のデータは CC0 です

## クレジット

### 地図データ

| データ | 使い方 | ライセンス・出典表示 |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright)（[Geofabrik の日本抽出](https://download.geofabrik.de/asia/japan.html)） | 島・水域・都道府県・市区町村 | ODbL 1.0。画面に「© OpenStreetMap contributors」 |
| [osmdata.openstreetmap.de の land polygons](https://osmdata.openstreetmap.de/data/land-polygons.html) | 陸地 | OSM 由来なので ODbL 1.0（上の表示に含まれる） |
| [Wikidata](https://www.wikidata.org/) | 知名度・人口・Wikipedia の記事名 | CC0（表示義務なし） |
| [国土地理院 標高タイル](https://maps.gsi.go.jp/development/ichiran.html)（`dem_png`、DEM10B） | 陰影（ブラウザで terrarium 形式に変換して描画） | [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)（公共データ利用規約 第1.0版）。出典の記載のみで申請不要。加工しているので、画面に「地理院タイル（標高を加工、最適化ベクトル）」とまとめて表示 |
| [国土地理院 最適化ベクトルタイル](https://github.com/gsi-cyberjapan/optimal_bvmap)（試験公開） | 等高線（`Cntr` レイヤー） | 同上の利用規約。画面の表示は上の行にまとめている。試験公開のため、URL やデータ構成が変わることがある |

国土地理院のタイルは、ブラウザから直接読み込みます（こちらで再配布はしていません）。

### フォント

- [DotGothic16](https://fonts.google.com/specimen/DotGothic16)（Fontworks）: [SIL Open Font License 1.1](https://openfontlicense.org/)。Google Fonts から読み込み

### ライブラリ

実行時に使うもの（ビルドに同梱）:

- [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js): BSD-3-Clause
- [PMTiles](https://github.com/protomaps/PMTiles): BSD-3-Clause

開発・データ生成に使うもの（配布物には含まれない）:

- [Turf](https://turfjs.org/): MIT
- [Playwright](https://playwright.dev/)（playwright-core。OGP 画像の撮影）: Apache-2.0
- [Vite](https://vite.dev/)・[Vitest](https://vitest.dev/): MIT
- [Wrangler](https://github.com/cloudflare/workers-sdk)・[@cloudflare/vite-plugin](https://github.com/cloudflare/workers-sdk): MIT または Apache-2.0
- [Biome](https://biomejs.dev/): MIT または Apache-2.0
- [TypeScript](https://www.typescriptlang.org/): Apache-2.0
- CLI: [osmium-tool](https://osmcode.org/osmium-tool/)（GPL-3.0）、[GDAL](https://gdal.org/)（MIT）、[tippecanoe](https://github.com/felt/tippecanoe)（BSD-2-Clause）。実行するだけで、配布物には含まれない

同梱した依存（間接的な依存を含む）のライセンス全文は、`pnpm build` で `dist/licenses.md` に出力されます（Vite の `build.license`）。
