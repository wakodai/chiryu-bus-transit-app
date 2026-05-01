# CLAUDE.md

知立市ミニバス乗換検索アプリの作業メモ。コードや README から読み取りにくい事項だけを書く。

## コマンド

- `npm run dev` — `http://localhost:5173` で起動
- `npm test` — Vitest ユニットテスト
- `npx tsc --noEmit` — 型チェック（テストやビルドの前に走らせる）
- `npm run build:gtfs` — GTFS-JP zip を再ダウンロードして `public/gtfs/*.json` に再変換
- `npm run build` — 本番ビルド（`dist/`）

## 動かす上で非自明なこと

### `public/gtfs/` は意図的にコミットしている

通常 Vite プロジェクトなら自動生成物として `.gitignore` する位置だが、このリポジトリでは
**初回クローンでネット接続なしで動かせるようにするため** にコミット運用している。
データ更新時は `npm run build:gtfs` を走らせて出る diff をコミットするのが正しい流れ。

### dev / localhost 限定のテストフック `window.__chiryu`

`src/ui/app.ts` の末尾で、`location.hostname === 'localhost'` のときだけ
`window.__chiryu = { simulateClick(lat, lon), runSearch() }` を露出している。
本番ホスティング（GitHub Pages / Cloudflare Pages / Netlify など）では gate で除外される。

Playwright などの E2E から地図を緯度経度精度で駆動したい時はこれを使う。
普通の `mouse.click` だと Leaflet のズーム/パンと衝突して扱いにくい。

### RAPTOR の dominance 罠

`src/routing/raptor.ts` で、出発地の歩きアクセス label（`transfers=-1` を持つ seed）を
**主 `labels` Map に入れてはいけない**。出発地クラスタと到着地クラスタが共通バス停を
含むケース（よくある）で、`-1` が後続の ride label を dominance で消し、経路が
silently 失われる。歩きアクセス seed は frontier だけに置く。`tests/raptor.test.ts` の
"finds a ride-based path even when origin and dest clusters overlap" がこの回帰テスト。

## 設計と実装履歴

- `docs/superpowers/specs/2026-05-01-chiryu-bus-transit-app-design.md` — 初期設計
- `docs/superpowers/plans/2026-05-01-chiryu-bus-transit-app.md` — 実装プラン
