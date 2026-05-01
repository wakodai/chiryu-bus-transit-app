# 徒歩乗換（foot transfer）対応 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RAPTOR 経路探索に「降車後に近接バス停まで歩いて別系統に乗り換える」徒歩乗換を組み込む。

**Architecture:** 起動時に全バス停ペアから 350m 以内のエッジを合成し、`Transfer[]` として `findRoutes` に渡す。乗換バッファ（+1 分）は徒歩エッジではなく ride 乗車判定で適用する。UI は結果カードで徒歩レグに乗換元/先のバス停名を表示する。

**Tech Stack:** TypeScript, Vitest, Vite, RBush（既存）

参照: `docs/superpowers/specs/2026-05-01-foot-transfer-design.md`

---

## ファイル構成

| 種別 | パス | 役割 |
| --- | --- | --- |
| 新規 | `src/data/foot-transfers.ts` | 徒歩乗換エッジ合成と関連定数（`WALK_M_PER_MIN`, `FOOT_TRANSFER_MAX_M`） |
| 新規 | `tests/foot-transfers.test.ts` | `synthesizeFootTransfers` の単体テスト |
| 修正 | `src/data/indexer.ts` | `GtfsIndex.footTransfers: Transfer[]` を追加し、`buildIndex` で合成 |
| 修正 | `src/routing/raptor.ts` | `FindRoutesParams.transferBufferMin` 追加、ride 乗車判定でバッファ適用 |
| 修正 | `tests/raptor.test.ts` | バッファ適用と徒歩乗換のテストを追加、既存呼び出しを更新 |
| 修正 | `src/ui/app.ts` | `idx.footTransfers` を渡し、`transferBufferMin: 1` を渡し、`WALK_M_PER_MIN` の参照を新モジュールに切替 |
| 修正 | `src/ui/result.ts` | walk レグに乗換元/先の停留所名を表示 |

---

## Task 1: `synthesizeFootTransfers` の合成ロジック (TDD)

**Files:**
- Create: `src/data/foot-transfers.ts`
- Test: `tests/foot-transfers.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/foot-transfers.test.ts` を新規作成:

```typescript
import { describe, expect, it } from 'vitest';
import type { Stop } from '../src/types.js';
import {
  FOOT_TRANSFER_MAX_M,
  WALK_M_PER_MIN,
  synthesizeFootTransfers,
} from '../src/data/foot-transfers.js';

// 緯度 35° 付近で、東西方向に 100m ≒ 0.001097°、南北方向に 100m ≒ 0.000900°。
// 簡略化のため経度 0 を基準に、経度差で距離を作る（緯度 35° では 100m 当たり経度差約 0.001097°）。
const ONE_HUNDRED_M_LON = 0.001097;

const stops: Stop[] = [
  { stop_id: 'A', stop_name: 'A', stop_lat: 35, stop_lon: 0 },
  // B: A から東に約 100m（threshold 350m 内）
  { stop_id: 'B', stop_name: 'B', stop_lat: 35, stop_lon: ONE_HUNDRED_M_LON },
  // C: A から東に約 1000m（threshold 外）
  { stop_id: 'C', stop_name: 'C', stop_lat: 35, stop_lon: ONE_HUNDRED_M_LON * 10 },
];

describe('synthesizeFootTransfers', () => {
  it('emits both directions for stop pairs within the threshold', () => {
    const out = synthesizeFootTransfers(stops, 350, 80);
    const ab = out.find((t) => t.from_stop_id === 'A' && t.to_stop_id === 'B');
    const ba = out.find((t) => t.from_stop_id === 'B' && t.to_stop_id === 'A');
    expect(ab).toBeDefined();
    expect(ba).toBeDefined();
    expect(ab!.min_transfer_time).toBe(ba!.min_transfer_time);
  });

  it('omits pairs over the threshold', () => {
    const out = synthesizeFootTransfers(stops, 350, 80);
    expect(out.find((t) => t.to_stop_id === 'C' || t.from_stop_id === 'C')).toBeUndefined();
  });

  it('emits no self-loops', () => {
    const out = synthesizeFootTransfers(stops, 350, 80);
    expect(out.every((t) => t.from_stop_id !== t.to_stop_id)).toBe(true);
  });

  it('encodes min_transfer_time as ceil(distance/walkMperMin)*60 seconds', () => {
    const out = synthesizeFootTransfers(stops, 350, 80);
    const ab = out.find((t) => t.from_stop_id === 'A' && t.to_stop_id === 'B')!;
    // 100m / 80 m/min = 1.25 min → ceil = 2 min → 120 秒
    expect(ab.min_transfer_time).toBe(120);
  });

  it('exposes the threshold and walk speed constants', () => {
    expect(FOOT_TRANSFER_MAX_M).toBe(350);
    expect(WALK_M_PER_MIN).toBe(80);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npm test -- foot-transfers
```

期待: 全 5 テストが「`src/data/foot-transfers.ts` が解決できない」で失敗。

- [ ] **Step 3: 実装を書く**

`src/data/foot-transfers.ts` を新規作成:

```typescript
import type { Stop, Transfer } from '../types.js';
import { haversine } from '../util/distance.js';

/** 徒歩速度（m/分）。出発地・目的地の徒歩アクセスと徒歩乗換で共通利用する。 */
export const WALK_M_PER_MIN = 80;

/** 徒歩乗換として採用する最大距離（m）。約 5 分歩行に相当。 */
export const FOOT_TRANSFER_MAX_M = 350;

/**
 * 全停留所ペアから距離 ≤ maxWalkMeters のものを抽出し、双方向の Transfer
 * エッジとして返す。自己ループは含めない。
 *
 * 知立 GTFS-JP の transfers.txt は自己ループのみで実質空のため、これが
 * RAPTOR に渡す唯一の徒歩乗換ソースとなる。
 */
export function synthesizeFootTransfers(
  stops: Stop[],
  maxWalkMeters: number,
  walkMperMin: number,
): Transfer[] {
  const out: Transfer[] = [];
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i];
    for (let j = i + 1; j < stops.length; j++) {
      const b = stops[j];
      const d = haversine(a.stop_lat, a.stop_lon, b.stop_lat, b.stop_lon);
      if (d > maxWalkMeters) continue;
      const minSec = Math.ceil(d / walkMperMin) * 60;
      out.push({
        from_stop_id: a.stop_id,
        to_stop_id: b.stop_id,
        transfer_type: 2,
        min_transfer_time: minSec,
      });
      out.push({
        from_stop_id: b.stop_id,
        to_stop_id: a.stop_id,
        transfer_type: 2,
        min_transfer_time: minSec,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
npm test -- foot-transfers
npx tsc --noEmit
```

期待: 5 テスト pass、型エラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/data/foot-transfers.ts tests/foot-transfers.test.ts
git commit -m "feat(routing): synthesizeFootTransfers で徒歩乗換エッジを合成

距離 350m 以内の停留所ペアから双方向の Transfer を生成する
ピュア関数を追加。WALK_M_PER_MIN と FOOT_TRANSFER_MAX_M の
共有定数もここに置く。"
```

---

## Task 2: RAPTOR に乗換バッファと徒歩乗換テストを追加 (TDD)

**Files:**
- Modify: `src/routing/raptor.ts:40-47, 106-110`
- Modify: `tests/raptor.test.ts`

- [ ] **Step 1: `FindRoutesParams` に `transferBufferMin` を追加（型のみ、ロジックはまだ）**

`src/routing/raptor.ts` の `FindRoutesParams` を修正:

```typescript
export interface FindRoutesParams {
  originStops: AccessStop[];
  destStops: AccessStop[];
  departureMin: number;
  activeServices: Set<string>;
  transfers: Transfer[];
  maxTransfers: number;
  /**
   * 乗換時に加算する分数。前レグが ride（label.transfers >= 0）の状態から
   * 次の bus に乗車する判定で `dep.departure_min >= label.arrival + transferBufferMin`
   * を要求する。出発地からの初回乗車（seed: transfers === -1）には適用しない。
   */
  transferBufferMin: number;
}
```

この時点ではロジックは触らない（`findRoutes` 本体は無視するパラメータが 1 つ増えるだけ）。

- [ ] **Step 2: 既存テストの呼び出しに `transferBufferMin: 1` を追加（バッファ=1 でも既存アサートは保たれる）**

`tests/raptor.test.ts` の既存 3 テストの `findRoutes(...)` 呼び出しに、それぞれ `transferBufferMin: 1,` を追加する。例:

```typescript
const front = findRoutes(idx, {
  originStops: [{ stop_id: 'A', walkMin: 0 }],
  destStops: [{ stop_id: 'X', walkMin: 0 }],
  departureMin: 480,
  activeServices: new Set(['serviceA']),
  transfers,
  maxTransfers: 2,
  transferBufferMin: 1,  // ← 追加
});
```

`returns both a direct and a 1-transfer path`、`returns empty when destination is unreachable`、`finds a ride-based path even when origin and dest clusters overlap` の 3 箇所すべてに同じ追加を行う。

- [ ] **Step 3: 新規テストを書く**

`tests/raptor.test.ts` の `describe('findRoutes (RAPTOR)', () => {` ブロック末尾に以下を追加:

```typescript
  it('+1 min transfer buffer prevents same-stop same-minute reboard', () => {
    // 停留所 P→Q（T1 で 12:30 着）、Q から T2（12:30 発）と T3（12:31 発）が出る
    const stops2 = [
      { stop_id: 'P', stop_name: 'P', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'Q', stop_name: 'Q', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'R', stop_name: 'R', stop_lat: 0, stop_lon: 0 },
    ];
    const trips2: Trip[] = [
      { route_id: 'R1', service_id: 'sv', trip_id: 'T1', trip_headsign: '', direction_id: '0', shape_id: 'S' },
      { route_id: 'R2', service_id: 'sv', trip_id: 'T2', trip_headsign: '', direction_id: '0', shape_id: 'S' },
      { route_id: 'R3', service_id: 'sv', trip_id: 'T3', trip_headsign: '', direction_id: '0', shape_id: 'S' },
    ];
    const sts2: StopTime[] = [
      { trip_id: 'T1', stop_id: 'P', stop_sequence: 1, arrival_min: 750, departure_min: 750 },
      { trip_id: 'T1', stop_id: 'Q', stop_sequence: 2, arrival_min: 760, departure_min: 760 },
      { trip_id: 'T2', stop_id: 'Q', stop_sequence: 1, arrival_min: 760, departure_min: 760 },
      { trip_id: 'T2', stop_id: 'R', stop_sequence: 2, arrival_min: 770, departure_min: 770 },
      { trip_id: 'T3', stop_id: 'Q', stop_sequence: 1, arrival_min: 761, departure_min: 761 },
      { trip_id: 'T3', stop_id: 'R', stop_sequence: 2, arrival_min: 771, departure_min: 771 },
    ];
    const idx = buildFixtureFrom(stops2, trips2, sts2);
    const front = findRoutes(idx, {
      originStops: [{ stop_id: 'P', walkMin: 0 }],
      destStops: [{ stop_id: 'R', walkMin: 0 }],
      departureMin: 750,
      activeServices: new Set(['sv']),
      transfers: [],
      maxTransfers: 2,
      transferBufferMin: 1,
    });
    expect(front.length).toBeGreaterThan(0);
    // T2 (Q 760 発) は Q 760 着 + 1 分バッファで弾かれ、T3 (Q 761 発) で 12:51 (771) 着になる
    expect(front.every((c) => c.arrivalMin === 771)).toBe(true);
  });

  it('+1 min transfer buffer applies after a foot-transfer walk leg', () => {
    // P→Q（T1 で 12:30 着）→徒歩 1 分→R で T2 (R 12:31 発) は弾かれ T3 (R 12:32 発) を選ぶ
    const stops2 = [
      { stop_id: 'P', stop_name: 'P', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'Q', stop_name: 'Q', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'R', stop_name: 'R', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'S', stop_name: 'S', stop_lat: 0, stop_lon: 0 },
    ];
    const trips2: Trip[] = [
      { route_id: 'R1', service_id: 'sv', trip_id: 'T1', trip_headsign: '', direction_id: '0', shape_id: 'S' },
      { route_id: 'R2', service_id: 'sv', trip_id: 'T2', trip_headsign: '', direction_id: '0', shape_id: 'S' },
      { route_id: 'R3', service_id: 'sv', trip_id: 'T3', trip_headsign: '', direction_id: '0', shape_id: 'S' },
    ];
    const sts2: StopTime[] = [
      { trip_id: 'T1', stop_id: 'P', stop_sequence: 1, arrival_min: 750, departure_min: 750 },
      { trip_id: 'T1', stop_id: 'Q', stop_sequence: 2, arrival_min: 760, departure_min: 760 },
      { trip_id: 'T2', stop_id: 'R', stop_sequence: 1, arrival_min: 761, departure_min: 761 },
      { trip_id: 'T2', stop_id: 'S', stop_sequence: 2, arrival_min: 770, departure_min: 770 },
      { trip_id: 'T3', stop_id: 'R', stop_sequence: 1, arrival_min: 762, departure_min: 762 },
      { trip_id: 'T3', stop_id: 'S', stop_sequence: 2, arrival_min: 771, departure_min: 771 },
    ];
    const idx = buildFixtureFrom(stops2, trips2, sts2);
    const transfers2: Transfer[] = [
      { from_stop_id: 'Q', to_stop_id: 'R', transfer_type: 2, min_transfer_time: 60 },
      { from_stop_id: 'R', to_stop_id: 'Q', transfer_type: 2, min_transfer_time: 60 },
    ];
    const front = findRoutes(idx, {
      originStops: [{ stop_id: 'P', walkMin: 0 }],
      destStops: [{ stop_id: 'S', walkMin: 0 }],
      departureMin: 750,
      activeServices: new Set(['sv']),
      transfers: transfers2,
      maxTransfers: 2,
      transferBufferMin: 1,
    });
    expect(front.length).toBeGreaterThan(0);
    // 徒歩 1 分 + バッファ 1 分 = R 着 761、乗車可能は 762 以降。T2 (761 発) は弾かれ T3 (762 発) → S 12:51 (771) 着
    expect(front.every((c) => c.arrivalMin === 771)).toBe(true);
  });

  it('uses a foot-transfer edge to reach an otherwise unreachable destination', () => {
    // 系統 A: P → Q、系統 B: R → S。Q-R 間に徒歩エッジが無いと到達不能。
    const stops2 = [
      { stop_id: 'P', stop_name: 'P', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'Q', stop_name: 'Q', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'R', stop_name: 'R', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'S', stop_name: 'S', stop_lat: 0, stop_lon: 0 },
    ];
    const trips2: Trip[] = [
      { route_id: 'R1', service_id: 'sv', trip_id: 'TA', trip_headsign: '', direction_id: '0', shape_id: 'S' },
      { route_id: 'R2', service_id: 'sv', trip_id: 'TB', trip_headsign: '', direction_id: '0', shape_id: 'S' },
    ];
    const sts2: StopTime[] = [
      { trip_id: 'TA', stop_id: 'P', stop_sequence: 1, arrival_min: 750, departure_min: 750 },
      { trip_id: 'TA', stop_id: 'Q', stop_sequence: 2, arrival_min: 760, departure_min: 760 },
      { trip_id: 'TB', stop_id: 'R', stop_sequence: 1, arrival_min: 765, departure_min: 765 },
      { trip_id: 'TB', stop_id: 'S', stop_sequence: 2, arrival_min: 775, departure_min: 775 },
    ];
    const idx = buildFixtureFrom(stops2, trips2, sts2);
    const transfers2: Transfer[] = [
      { from_stop_id: 'Q', to_stop_id: 'R', transfer_type: 2, min_transfer_time: 120 },
      { from_stop_id: 'R', to_stop_id: 'Q', transfer_type: 2, min_transfer_time: 120 },
    ];
    const front = findRoutes(idx, {
      originStops: [{ stop_id: 'P', walkMin: 0 }],
      destStops: [{ stop_id: 'S', walkMin: 0 }],
      departureMin: 750,
      activeServices: new Set(['sv']),
      transfers: transfers2,
      maxTransfers: 2,
      transferBufferMin: 1,
    });
    expect(front.length).toBeGreaterThan(0);
    expect(front[0].arrivalMin).toBe(775);
    const legKinds = front[0].legs.map((l) => l.kind);
    expect(legKinds).toEqual(['ride', 'walk', 'ride']);
  });
```

そしてファイル先頭近く（既存 `buildFixture` の直後）に、汎用フィクスチャヘルパを追加:

```typescript
function buildFixtureFrom(stopList: Stop[], tripList: Trip[], stList: StopTime[]): GtfsIndex {
  const stopById = new Map(stopList.map((s) => [s.stop_id, s]));
  const tripById = new Map(tripList.map((t) => [t.trip_id, t]));

  const stopTimesByTrip = new Map<string, StopTime[]>();
  for (const st of stList) {
    let a = stopTimesByTrip.get(st.trip_id);
    if (!a) {
      a = [];
      stopTimesByTrip.set(st.trip_id, a);
    }
    a.push(st);
  }
  for (const a of stopTimesByTrip.values()) a.sort((x, y) => x.stop_sequence - y.stop_sequence);

  const departuresByStop = new Map<string, DepartureEntry[]>();
  for (const [tripId, sts] of stopTimesByTrip) {
    for (const st of sts) {
      if (st.stop_sequence === sts[sts.length - 1].stop_sequence) continue;
      let a = departuresByStop.get(st.stop_id);
      if (!a) {
        a = [];
        departuresByStop.set(st.stop_id, a);
      }
      a.push({ trip_id: tripId, stop_sequence: st.stop_sequence, departure_min: st.departure_min });
    }
  }
  for (const a of departuresByStop.values()) a.sort((x, y) => x.departure_min - y.departure_min);

  return {
    stopTree: { search: () => [] } as never,
    stopById,
    tripById,
    routeById: new Map(),
    departuresByStop,
    stopTimesByTrip,
    footTransfers: [],
  };
}
```

Note: `footTransfers: []` は Task 3 で追加するフィールドだが、ここで先に書いておくと Task 3 で別途修正する必要がない。Task 2 の `tsc` チェック時にはまだ型に存在しないのでエラーになる。**Step 1 と Step 2 のタイミングでは `footTransfers: []` を含めず、Task 3 完了時に Step を追加する。**

→ よって本 Step では `footTransfers: []` を **入れない**。

- [ ] **Step 4: テストが失敗することを確認**

```bash
npm test -- raptor
npx tsc --noEmit
```

期待: 型エラーなし（Step 1 で `transferBufferMin` を型に追加済み）。テストは既存 3 つは pass（ロジック未実装でも buffer=1 で既存アサートは保たれる）、新規 3 つは fail。

- [ ] **Step 5: `findRoutes` のロジックを実装**

`src/routing/raptor.ts` の ride loop の判定を変更（既存 109 行付近の `if (dep.departure_min < label.arrival) continue;` を置き換え）:

```typescript
      for (const dep of deps) {
        const minBoardMin =
          label.transfers >= 0 ? label.arrival + p.transferBufferMin : label.arrival;
        if (dep.departure_min < minBoardMin) continue;
        // ...（以降変更なし）
```

- [ ] **Step 6: テストが通ることを確認**

```bash
npm test -- raptor
npx tsc --noEmit
```

期待: 既存 3 + 新規 3 = 6 テスト全 pass、型エラーなし。

- [ ] **Step 7: コミット**

```bash
git add src/routing/raptor.ts tests/raptor.test.ts
git commit -m "feat(routing): RAPTOR に乗換バッファを追加し徒歩乗換を有効化

label.transfers >= 0（ride 後）の状態から次の bus に乗車する際、
transferBufferMin を加算した時刻以降の便のみ採用する。同一停留所
乗換と徒歩乗換の両方に等しくバッファがかかる。"
```

---

## Task 3: Indexer に `footTransfers` を組み込む

**Files:**
- Modify: `src/data/indexer.ts:18-25, 27-72`
- Modify: `tests/raptor.test.ts`（既存 `buildFixture` ヘルパに `footTransfers: []` を追加）

- [ ] **Step 1: 失敗するアサーションを `tests/foot-transfers.test.ts` に追加**

`tests/foot-transfers.test.ts` の末尾に以下の `describe` を追加:

```typescript
import { buildIndex } from '../src/data/indexer.js';
import type { GtfsData } from '../src/types.js';

function emptyGtfsData(): GtfsData {
  return {
    stops: [
      { stop_id: 'A', stop_name: 'A', stop_lat: 35, stop_lon: 0 },
      { stop_id: 'B', stop_name: 'B', stop_lat: 35, stop_lon: 0.001097 },
    ],
    routes: [],
    trips: [],
    stopTimes: [],
    calendar: [],
    calendarDates: [],
    transfers: [],
    shapes: [],
    feedInfo: {
      feed_publisher_name: '',
      feed_publisher_url: '',
      feed_lang: '',
      feed_start_date: '',
      feed_end_date: '',
      feed_version: '',
    },
  };
}

describe('buildIndex foot transfer wiring', () => {
  it('exposes synthesized footTransfers on the index', () => {
    const idx = buildIndex(emptyGtfsData());
    expect(idx.footTransfers.length).toBeGreaterThan(0);
    // 双方向で 2 件
    expect(idx.footTransfers.length).toBe(2);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npm test -- foot-transfers
```

期待: 「`idx.footTransfers` が undefined」または型エラーで失敗。

- [ ] **Step 3: `src/data/indexer.ts` を修正**

import を追加:

```typescript
import type { GtfsData, Route, Stop, StopTime, Transfer, Trip } from '../types.js';
import { FOOT_TRANSFER_MAX_M, WALK_M_PER_MIN, synthesizeFootTransfers } from './foot-transfers.js';
```

`GtfsIndex` interface に追加:

```typescript
export interface GtfsIndex {
  stopTree: RBush<StopBoxItem>;
  stopById: Map<string, Stop>;
  tripById: Map<string, Trip>;
  routeById: Map<string, Route>;
  departuresByStop: Map<string, DepartureEntry[]>;
  stopTimesByTrip: Map<string, StopTime[]>;
  footTransfers: Transfer[];
}
```

`buildIndex` 末尾を変更:

```typescript
  const footTransfers = synthesizeFootTransfers(data.stops, FOOT_TRANSFER_MAX_M, WALK_M_PER_MIN);

  return {
    stopTree,
    stopById,
    tripById,
    routeById,
    departuresByStop,
    stopTimesByTrip,
    footTransfers,
  };
}
```

- [ ] **Step 4: 既存の RAPTOR テストフィクスチャに `footTransfers: []` を追加**

`tests/raptor.test.ts` の `buildFixture` 関数の戻り値、および Task 2 で新設した `buildFixtureFrom` の戻り値の両方に `footTransfers: []` を追加:

```typescript
  return {
    stopTree: { search: () => [] } as never,
    stopById,
    tripById,
    routeById: new Map(),
    departuresByStop,
    stopTimesByTrip,
    footTransfers: [],
  };
```

- [ ] **Step 5: テストと型チェック**

```bash
npm test
npx tsc --noEmit
```

期待: 全テスト pass（foot-transfers 新規 1、raptor 6、既存 calendar/nearest/select/shape/time すべて）、型エラーなし。

- [ ] **Step 6: コミット**

```bash
git add src/data/indexer.ts tests/foot-transfers.test.ts tests/raptor.test.ts
git commit -m "feat(data): GtfsIndex.footTransfers を buildIndex で合成

stops から距離 350m 以内の徒歩乗換エッジを起動時に生成し
GtfsIndex に持たせる。既存テストフィクスチャに新フィールドを反映。"
```

---

## Task 4: `app.ts` を新しいデータパスに切り替える

**Files:**
- Modify: `src/ui/app.ts:12, 174-187`

- [ ] **Step 1: import と定数参照を修正**

`src/ui/app.ts` の上部を修正。既存:

```typescript
const WALK_M_PER_MIN = 80;
```

を削除し、import 行に `WALK_M_PER_MIN` を追加:

```typescript
import { WALK_M_PER_MIN } from '../data/foot-transfers.js';
```

- [ ] **Step 2: `findRoutes` 呼び出しを更新**

`src/ui/app.ts` の `findRoutes(idx, { ... })` 呼び出し（185 行付近）を以下に置き換え:

```typescript
    const front = findRoutes(idx, {
      originStops: o.near.map((n) => ({
        stop_id: n.stop.stop_id,
        walkMin: Math.ceil(n.distance / WALK_M_PER_MIN),
      })),
      destStops: d.near.map((n) => ({
        stop_id: n.stop.stop_id,
        walkMin: Math.ceil(n.distance / WALK_M_PER_MIN),
      })),
      departureMin,
      activeServices: services,
      transfers: idx.footTransfers,
      maxTransfers: 2,
      transferBufferMin: 1,
    });
```

- [ ] **Step 3: 型チェック**

```bash
npx tsc --noEmit
```

期待: 型エラーなし。

- [ ] **Step 4: 全テスト**

```bash
npm test
```

期待: 全 pass。

- [ ] **Step 5: dev サーバで動作確認**

```bash
npm run dev
```

ブラウザで `http://localhost:5173` を開き、知立駅周辺など適当な 2 点を origin/destination に指定して検索。

確認項目:
- 結果カードがエラーなく表示される
- 徒歩レグ（🚶 行）を含む候補が現れることがある（必ずしも全パターンで出るとは限らない）
- 2 回目以降の検索もエラーなく動作する

問題なければ Ctrl+C で停止。

- [ ] **Step 6: コミット**

```bash
git add src/ui/app.ts
git commit -m "feat(ui): findRoutes に idx.footTransfers と transferBufferMin=1 を渡す

app.ts は GTFS feed の transfers.json 由来 (data.transfers) を読まなくなる。
WALK_M_PER_MIN は foot-transfers モジュールの公開定数を参照する。"
```

---

## Task 5: 結果カードの徒歩レグに乗換元/先のバス停名を表示

**Files:**
- Modify: `src/ui/result.ts:111-114`

- [ ] **Step 1: 徒歩レグのレンダリングを更新**

`src/ui/result.ts` の walk レグの分岐（111 行付近、`} else {` ブロック内）を修正。

修正前:

```typescript
} else {
  row.textContent = `🚶 ${formatMin(leg.fromMin)} → ${formatMin(leg.toMin)}（徒歩${leg.toMin - leg.fromMin}分）`;
  card.appendChild(row);
}
```

修正後:

```typescript
} else {
  const fromName = idx.stopById.get(leg.fromStopId)?.stop_name ?? leg.fromStopId;
  const toName = idx.stopById.get(leg.toStopId)?.stop_name ?? leg.toStopId;
  row.textContent = `🚶 ${formatMin(leg.fromMin)} ${fromName} → ${formatMin(leg.toMin)} ${toName}（徒歩${leg.toMin - leg.fromMin}分）`;
  card.appendChild(row);
}
```

- [ ] **Step 2: 型チェック**

```bash
npx tsc --noEmit
```

期待: 型エラーなし。

- [ ] **Step 3: dev サーバで目視確認**

```bash
npm run dev
```

徒歩乗換を含む候補が出るケースで「🚶 12:34 ○○バス停 → 12:39 △△バス停（徒歩5分）」の形式になっていることを確認。

- [ ] **Step 4: 本番ビルド確認**

```bash
npm run build
```

期待: ビルド成功（型エラー・lint エラーなし）。

- [ ] **Step 5: コミット**

```bash
git add src/ui/result.ts
git commit -m "feat(ui): 結果カードの徒歩レグに乗換元/先の停留所名を表示

徒歩乗換のとき、どのバス停からどのバス停へ歩くのかが
テキストで分かるようにする。"
```

---

## 完了基準

- `npm test` 全 pass（既存 + 新規 7 テスト追加）
- `npx tsc --noEmit` 型エラーなし
- `npm run build` 成功
- dev サーバで実データ検索が動作し、徒歩乗換を含む候補が Pareto front に乗る場面を 1 つ以上目視確認
- 既存の `tests/raptor.test.ts` の dominance 回帰テストが引き続き pass
