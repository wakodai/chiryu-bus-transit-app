# 知立市ミニバス 乗換検索 Web アプリ

愛知県知立市のコミュニティバス「ミニバス」を対象とした、地図ベースの乗換検索 Web アプリです。

## 機能

- 地図クリック2回で出発地・到着地を指定（最寄りバス停を自動選定）
- 出発日時を指定して経路検索
- 結果は最大3案（最早着・最少乗換・直行 を Pareto フロントから抽出）
- 選択した経路を地図上にハイライト

## 開発

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # ユニットテスト
npm run lint
```

## GTFS データの更新

```bash
npm run build:gtfs
```

`public/gtfs/` 配下の JSON が再生成されます。

## ビルド・公開

```bash
npm run build    # dist/ に静的ファイル一式
```

`dist/` を任意の静的ホスティング（GitHub Pages / Cloudflare Pages / Netlify など）にデプロイ可能。

## データ出典

- 知立市「ミニバス」GTFS-JP データ（[CC BY 2.1 JP](https://creativecommons.org/licenses/by/2.1/jp/)）
- 配信元: [GTFS データリポジトリ](https://gtfs-data.jp/)
- 地図タイル: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors

## 設計・実装プラン

- 設計: [docs/superpowers/specs/2026-05-01-chiryu-bus-transit-app-design.md](docs/superpowers/specs/2026-05-01-chiryu-bus-transit-app-design.md)
- 実装プラン: [docs/superpowers/plans/2026-05-01-chiryu-bus-transit-app.md](docs/superpowers/plans/2026-05-01-chiryu-bus-transit-app.md)
