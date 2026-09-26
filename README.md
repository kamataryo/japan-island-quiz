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

## デプロイ

`main` への push（または Actions の手動実行）で Cloudflare Workers（workers.dev）にデプロイされます（`.github/workflows/deploy.yml`、設定は `wrangler.jsonc`）。
静的ファイルは Workers の静的アセットとして配り、次の2つだけ Worker が処理します。

- `/tiles/{z}/{x}/{y}.mvt`: R2 に置いた `base.pmtiles` からタイルを1枚ずつ返す（静的アセットは Range リクエストに対応していないため）
- `/api/answers`: 島ごとの正答率の集計（D1）

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
- [Vite](https://vite.dev/)・[Vitest](https://vitest.dev/): MIT
- [Biome](https://biomejs.dev/): MIT または Apache-2.0
- [TypeScript](https://www.typescriptlang.org/): Apache-2.0
- CLI: [osmium-tool](https://osmcode.org/osmium-tool/)（GPL-3.0）、[GDAL](https://gdal.org/)（MIT）、[tippecanoe](https://github.com/felt/tippecanoe)（BSD-2-Clause）。実行するだけで、配布物には含まれない

同梱した依存（間接的な依存を含む）のライセンス全文は、`pnpm build` で `dist/licenses.md` に出力されます（Vite の `build.license`）。
