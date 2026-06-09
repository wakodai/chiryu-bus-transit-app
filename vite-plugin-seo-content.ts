import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HtmlTagDescriptor, Plugin } from 'vite';

/**
 * ビルド時 / dev 時に GTFS データから静的 SEO コンテンツを生成し、
 * index.html のプレースホルダ <!--seo:content--> を置換する。
 * あわせて WebApplication の JSON-LD を <head> に注入する。
 *
 * 生成物はコミットしない（index.html はプレースホルダのまま）。
 * npm run build:gtfs でデータを更新すれば次のビルドで自動反映される。
 * 詳細は docs/superpowers/specs/2026-06-09-seo-static-content-design.md。
 */

interface Route {
  route_id: string;
  route_long_name: string;
}
interface Trip {
  route_id: string;
  trip_id: string;
}
interface StopTime {
  trip_id: string;
  stop_id: string;
  stop_sequence: string;
}
interface Stop {
  stop_id: string;
  stop_name: string;
}

const SITE_URL = 'https://wakodai.github.io/chiryu-bus-transit-app/';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readGtfs<T>(gtfsDir: string, name: string): T[] {
  return JSON.parse(readFileSync(join(gtfsDir, name), 'utf8')) as T[];
}

interface SeoData {
  routes: { name: string; path: string[] }[];
  stopNames: string[];
}

function buildSeoData(gtfsDir: string): SeoData {
  const routes = readGtfs<Route>(gtfsDir, 'routes.json');
  const trips = readGtfs<Trip>(gtfsDir, 'trips.json');
  const stopTimes = readGtfs<StopTime>(gtfsDir, 'stop_times.json');
  const stops = readGtfs<Stop>(gtfsDir, 'stops.json');

  const stopName = new Map(stops.map((s) => [s.stop_id, s.stop_name]));

  const tripsByRoute = new Map<string, string[]>();
  for (const t of trips) {
    const list = tripsByRoute.get(t.route_id) ?? [];
    list.push(t.trip_id);
    tripsByRoute.set(t.route_id, list);
  }

  const stopTimesByTrip = new Map<string, StopTime[]>();
  for (const st of stopTimes) {
    const list = stopTimesByTrip.get(st.trip_id) ?? [];
    list.push(st);
    stopTimesByTrip.set(st.trip_id, list);
  }

  // route_long_name が同一の系統（例: 3コースの 30/31）は 1 つにまとめ、
  // 最も停留所数の多い代表便を採用する。
  const byName = new Map<string, { name: string; path: string[] }>();
  for (const route of routes) {
    const tripIds = tripsByRoute.get(route.route_id) ?? [];
    let bestPath: string[] = [];
    for (const tid of tripIds) {
      const seq = (stopTimesByTrip.get(tid) ?? [])
        .slice()
        .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
      if (seq.length > bestPath.length) {
        bestPath = seq.map((st) => stopName.get(st.stop_id) ?? '');
      }
    }
    const existing = byName.get(route.route_long_name);
    if (!existing || bestPath.length > existing.path.length) {
      byName.set(route.route_long_name, { name: route.route_long_name, path: bestPath });
    }
  }

  // stop_id 順でユニークなバス停名を列挙する。
  const stopNames: string[] = [];
  const seen = new Set<string>();
  for (const s of stops.slice().sort((a, b) => a.stop_id.localeCompare(b.stop_id))) {
    if (!seen.has(s.stop_name)) {
      seen.add(s.stop_name);
      stopNames.push(s.stop_name);
    }
  }

  return { routes: [...byName.values()], stopNames };
}

function renderSection(data: SeoData): string {
  const routeBlocks = data.routes
    .map((r) => {
      const path = r.path.map(escapeHtml).join(' → ');
      return `      <h3>${escapeHtml(r.name)}</h3>\n      <p>主な経路：${path}</p>`;
    })
    .join('\n');
  const stopItems = data.stopNames
    .map((n) => `        <li>${escapeHtml(n)}</li>`)
    .join('\n');
  return `<section id="seo-content" class="seo-content">
      <h2>知立市ミニバスの路線・バス停一覧</h2>
      <p>知立市のミニバス（コミュニティバス）の各コースと、通過するバス停を一覧で掲載しています。出発地・到着地のバス停を地図上でクリックすると、乗換を含む経路と時刻を検索できます。</p>
${routeBlocks}
      <h3>全バス停一覧</h3>
      <ul class="seo-stop-list">
${stopItems}
      </ul>
    </section>`;
}

function renderJsonLd(data: SeoData): string {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: '知立市ミニバス 乗換検索（非公式）',
    description:
      '知立市ミニバスの乗換・時刻表・経路を地図から検索できる非公式アプリ。出発地と到着地をクリックするだけで経路を表示します。',
    url: SITE_URL,
    applicationCategory: 'TravelApplication',
    operatingSystem: 'Web',
    inLanguage: 'ja',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'JPY' },
    about: {
      '@type': 'BusOrCoach',
      name: '知立市ミニバス',
      provider: { '@type': 'GovernmentOrganization', name: '知立市' },
    },
    keywords: ['知立市', 'ミニバス', 'バス', '乗換', '時刻表', '経路検索', ...data.routes.map((r) => r.name)],
  };
  return JSON.stringify(json);
}

export default function seoContentPlugin(): Plugin {
  return {
    name: 'seo-content',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // public/gtfs はリポジトリルートからの相対。
        const root = process.cwd();
        const gtfsDir = join(root, 'public', 'gtfs');
        const data = buildSeoData(gtfsDir);

        const replaced = html.replace('<!--seo:content-->', renderSection(data));

        const tags: HtmlTagDescriptor[] = [
          {
            tag: 'script',
            attrs: { type: 'application/ld+json' },
            children: renderJsonLd(data),
            injectTo: 'head',
          },
        ];

        return { html: replaced, tags };
      },
    },
  };
}
