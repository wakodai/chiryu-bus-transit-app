---
date: 2026-06-09 00:00
title: GTFS 駆動の静的 SEO コンテンツと構造化データ
---

# GTFS 駆動の静的 SEO コンテンツと構造化データ

## 背景・目的

本アプリは Vite SPA で、`index.html` の `<body>` には実コンテンツがほぼ無く
（見出しと注意書きのみ）、路線・時刻・経路はすべて JS で描画される。
Googlebot は JS をレンダリングするが不安定で、そもそも評価対象のテキストが
不足しているため「知立 バス」系の検索でインデックス・上位表示が期待できない。

ビッグワード（知立 バス）は公式ページ・大手乗換サイトに占有されるため、
**ロングテール（知立 ミニバス 乗換 / 時刻表 / 経路、路線名・バス停名）で拾える
母数を増やす**ことを狙う。そのため Googlebot がレンダリング不要で読める静的
テキストを増やすのが本作業の主眼。

## スコープ

含める:

1. GTFS データから生成する静的セクション（路線ごとの通過バス停一覧 + 全バス停一覧）
2. `WebApplication` の JSON-LD 構造化データ
3. `<title>` / `meta description` のロングテール最適化

含めない（今回のブレストで除外）:

- 「ミニバスとは / 料金 / 運行日」の手書きプローズ。静的セクションには
  リストへの最小限の導入文のみ置き、料金・運行日などの主張は載せない
  （事実確認の負担とドリフトを避ける）。
- 路線ごと・バス停ごとの個別ページ生成（サイト規模的に thin content リスク）。

## アーキテクチャ

Vite カスタムプラグイン `vite-plugin-seo-content.ts` を 1 つ追加する。

- `transformIndexHtml` フック（dev / build 双方で実行）で
  `public/gtfs/{routes,trips,stop_times,stops}.json` を読み込む。
- `index.html` 内のプレースホルダ `<!--seo:content-->` を、生成した
  静的セクション HTML で置換する。
- JSON-LD は `tags`（`injectTo: 'head'`）で `<head>` に注入する。
- 生成物はコミットしない。`index.html` はプレースホルダのまま。
  → `npm run build:gtfs` でデータ更新すれば次ビルドで自動反映され、
    古いバス停名が残るドリフトが起きない。
- アプリの JS・検索ロジックには一切手を入れない。追加するのは静的テキストと
  head タグのみ。

### データ結合

- `trips.json` の `route_id` で路線ごとに trip をグルーピング。
- 各路線で最も停留所数の多い trip を「代表便」として選ぶ。
- `stop_times.json` を `trip_id` で引き、`stop_sequence` 昇順に並べ、
  `stops.json` で `stop_id` → `stop_name` に解決して通過順の経路を作る。
- 全バス停一覧は `stops.json` の `stop_name` をユニーク化し `stop_id` 順で出力。

## 生成する HTML

side-panel 内、既存 `<footer>` の直後に可視セクションを置く（パネルは
`overflow-y:auto` なのでスクロールで到達でき、Googlebot も読める）。

```
<section id="seo-content" class="seo-content">
  <h2>知立市ミニバスの路線・バス停一覧</h2>
  <p>（リストへの最小限の導入文）</p>
  <h3>ミニバス1コース（グリーンコース）</h3>
  <p>主な経路：知立駅 → 宝町 → 福祉体育館 → …</p>
  …（6 系統分。route_long_name を見出しに使用）…
  <h3>全バス停一覧</h3>
  <ul><li>知立駅</li>…（ユニーク92件）…</ul>
</section>
```

スタイルは `src/style.css` に `.seo-content` を追加し、既存の側パネルの
トーン（控えめなフォントサイズ・色）に合わせる。

## title / description

- title: `知立市ミニバス 乗換・時刻表検索｜路線・バス停・経路（非公式）`
- description: 時刻表・路線・バス停・経路の語を含むよう調整。
- これらは `index.html` に直接記述（データ依存がないためプラグイン不要）。

## JSON-LD（WebApplication）

`<head>` に `application/ld+json` を注入。name / description / url /
applicationCategory / inLanguage / isAccessibleForFree / 運行主体（知立市）
への言及などを含める。路線名はデータから生成して同期させる。

## テスト・検証

- `npx tsc --noEmit` で型チェック。
- `npm run build` で `dist/index.html` を生成し、注入された路線名・バス停名・
  JSON-LD が含まれることを grep で確認。
- 既存の Vitest（routing 等）が引き続き通ること。
- アプリの動作（dev で地図・検索）が壊れていないこと。
