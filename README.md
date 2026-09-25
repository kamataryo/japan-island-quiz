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

## ライセンス

- ソースコード: [MIT](./LICENSE)
- 生成データ（`public/data/` 以下の OSM 由来データ）: [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)（詳細はフェーズ2で追記）

## クレジット

（フェーズ6で整理: OpenStreetMap、国土地理院、フォント、ライブラリ）
