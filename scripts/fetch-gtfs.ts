import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import Papa from 'papaparse';

const FEED_URL =
  'https://api.gtfs-data.jp/v2/organizations/chiryucity/feeds/communitybus/files/feed.zip?rid=current';

const FILES = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'transfers.txt',
  'shapes.txt',
  'feed_info.txt',
  'fare_attributes.txt',
  'fare_rules.txt',
] as const;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outDir = join(repoRoot, 'public', 'gtfs');
const tmpDir = join(repoRoot, 'data', 'raw');

async function main() {
  console.log(`Downloading ${FEED_URL}`);
  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  mkdirSync(tmpDir, { recursive: true });
  const zipPath = join(tmpDir, 'chiryu_minibus.zip');
  writeFileSync(zipPath, buf);
  console.log(`Saved zip (${buf.length} bytes) to ${zipPath}`);

  const zip = new AdmZip(zipPath);
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const filename of FILES) {
    const entry = zip.getEntry(filename);
    if (!entry) {
      console.warn(`  (skip) ${filename} not in zip`);
      continue;
    }
    const csv = entry.getData().toString('utf8');
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true, dynamicTyping: false });
    if (parsed.errors.length) console.warn(`  (warn) ${filename}: ${parsed.errors.length} parse warnings`);
    const jsonName = filename.replace(/\.txt$/, '.json');
    writeFileSync(join(outDir, jsonName), JSON.stringify(parsed.data));
    console.log(`  wrote ${jsonName} (${parsed.data.length} rows)`);
  }

  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
