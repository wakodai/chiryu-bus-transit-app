---
created: 2026-05-01 12:00
tags: [design, routing, raptor, transfer]
---

# 徒歩乗換（foot transfer）対応 設計

## 背景

知立市ミニバス GTFS-JP feed の `transfers.txt` は自己ループ
（`from_stop_id === to_stop_id`）のみで実質的なエッジが存在しない。
そのため `src/routing/raptor.ts` の `transferAdj` は常に空で、
**降車したバス停と異なる停留所への徒歩乗換が発生しない** 状態になっている。

中間停留所での同一バス停乗換（暗黙の stay-put 乗換）と、出発地・目的地から
半径 700m 以内の停留所クラスタへの徒歩アクセスは動作しているが、
ルート途中で降りて 100〜300m 先の別停留所に歩いて別系統に乗る、
という現実的な乗換が経路探索に乗らない。

## ゴール

ルート途中でバス停 A に降車後、近接する別停留所 B（徒歩 5 分以内）まで
歩いて別系統のバスに乗り換える経路を、RAPTOR の探索対象として扱う。

## 非ゴール

- 地図上での徒歩乗換区間のポリライン描画（結果カードのテキストのみ対応）
- 閾値・歩行速度の UI からの動的設定（コード定数で固定）
- 多段の徒歩エッジ連鎖（A→B→C のチェイン）。350m 閾値で発生する直接エッジのみ。

## 仕様

### パラメータ

| 項目 | 値 | 出所 |
| --- | --- | --- |
| 徒歩乗換の最大距離 | 350m | 新規定数 |
| 歩行速度 | 80 m/min | 既存 `WALK_M_PER_MIN`（`src/ui/app.ts`） |
| 1 エッジの所要分 | `ceil(distance_m / 80)` 分 | 既存の出発地/目的地クラスタと同じ |
| 乗換バッファ | +1 分（乗車判定時に加算） | 新規 `transferBufferMin = 1` |

### 振る舞い

1. **徒歩乗換エッジの生成**：起動時に全停留所ペアを評価し、距離 ≤ 350m の
   組について双方向の `Transfer` を合成する（自己ループは含めない）。
2. **乗車時バッファ判定**：前レグが ride である label（`label.transfers >= 0`）
   から bus に乗車する場合、`dep.departure_min >= label.arrival + transferBufferMin`
   を要求する。出発地からの初回乗車（seed: `transfers = -1`）にはバッファを
   適用しない。
3. **徒歩エッジ自体は純粋な歩行時間のみ**を加算する。バッファは乗車時にしか
   かからないので、徒歩乗換も同一停留所乗換も「+1 分」の影響を平等に受ける。
4. **結果カードの表記**：徒歩レグに乗換元/先のバス停名を表示する。
   形式: `🚶 12:34 ○○バス停 → 12:39 △△バス停（徒歩5分）`

### 影響範囲

| ファイル | 変更内容 |
| --- | --- |
| `src/data/foot-transfers.ts` (新規) | `synthesizeFootTransfers(stops, maxWalkM, walkMperMin): Transfer[]` |
| `src/data/indexer.ts` | `GtfsIndex` に `footTransfers: Transfer[]` を追加し、`buildIndex` で合成 |
| `src/routing/raptor.ts` | `FindRoutesParams.transferBufferMin` を追加。乗車判定で `label.transfers >= 0` のとき `+ transferBufferMin` を要求 |
| `src/ui/app.ts` | `transfers.json` の読み込みを廃止し、`idx.footTransfers` を `findRoutes` に渡す。`transferBufferMin: 1` を渡す |
| `src/ui/result.ts` | walk レグを `from/to` 停留所名つきで表示 |

`scripts/fetch-gtfs.ts` および `public/gtfs/transfers.json` は触らない（feed の
内容そのものは保持し、アプリ側で使わないだけ）。

## アルゴリズム上の正しさ

### 既存の dominance 罠との関係

`raptor.ts` には「歩きアクセス seed (transfers = -1) を主 `labels` Map に
入れない」という既知の dominance 罠がある（CLAUDE.md 記載・回帰テストあり）。
本変更ではこの設計を維持する。徒歩乗換エッジは ride 後の post-foot label で
あり `transfers >= 0` を持つため、seed と混同される心配はない。

### 乗換回数のカウント

現在の RAPTOR 実装では:
- 徒歩エッジは `transfers` を増やさない
- ride エッジは `transfers + 1` する

つまり「ride → walk → ride」と「ride → 同一停留所 → ride」は
ともに transfers = 1 でカウントされる。これは想定どおりであり、
本変更で `maxTransfers` の意味は変わらない。

### バッファ位置の妥当性

バッファを「徒歩エッジの所要時間に加える」のではなく
「ride 乗車判定時に加える」設計にした理由は次のとおり:

- 同一停留所の暗黙乗換（徒歩エッジを通らない）にも自然にバッファがかかる
- 徒歩エッジ自体は純粋な距離換算のままなので、エッジ生成と意味論を分離できる
- バッファ値を将来変えたい場合の影響範囲が小さい

副作用として、徒歩 5 分のエッジは「実効待ち時間 6 分」として動作する。
これは「歩いた直後 1 分は乗り場確認・運賃支払で消費する」という実用的な
モデルになっており、設計判断として妥当と考える。

## テスト戦略

### `tests/foot-transfers.test.ts` (新規)

- 合成テスト用の小さな停留所セット（テスト内でリテラル定義）から:
  - 距離 ≤ 350m のペアで双方向の `Transfer` が生成されること
  - 距離 > 350m のペアではエッジが生成されないこと
  - 自己ループ（`from_stop_id === to_stop_id`）が含まれないこと
  - `min_transfer_time` が `ceil(distance / 80) * 60` 秒で、双方向で同値であること

### `tests/raptor.test.ts` (拡張)

- **徒歩乗換でしか到達できない経路が見つかる**:
  停留所 A から系統 X が出発、停留所 B（A から 200m）から系統 Y が出発、
  X と Y で同名停留所が無いケース。出発地→A→（徒歩）→B→Y→終点
  という経路が候補に出ること。
- **+1 分バッファが同一停留所で効く**:
  停留所 A に 12:30 着、A 発 12:30 のバスがあるとき、当該バスは選ばれず
  次の便（例: 12:35）が選ばれること。
- **+1 分バッファが徒歩乗換でも効く**:
  A に 12:30 着、徒歩 3 分エッジで B に 12:33 到達、B 発 12:33 の便は
  選ばれず B 発 12:34 以降が選ばれること。
- 既存の dominance 回帰テスト
  （"finds a ride-based path even when origin and dest clusters overlap"）が
  引き続き通ること。

### 統合確認

- `npm test` でユニット全件 pass
- `npx tsc --noEmit` で型エラーなし
- `npm run dev` で起動し、知立駅周辺など実データで「徒歩乗換を含む候補」が
  Pareto front に乗ることを目視確認

## ロールアウト

機能フラグ・段階展開は不要。全ユーザに対して即時有効化する。
GTFS データの再ダウンロードも不要（`public/gtfs/transfers.json` は
不使用化されるが削除はしない）。
