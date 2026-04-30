import type { GtfsIndex } from '../data/indexer.js';
import type { RouteCandidate } from '../routing/raptor.js';
import { formatMin } from '../util/time.js';

export interface ResultPanelOptions {
  container: HTMLElement;
  onSelect: (index: number, candidate: RouteCandidate) => void;
}

export class ResultPanel {
  private opts: ResultPanelOptions;

  constructor(opts: ResultPanelOptions) {
    this.opts = opts;
  }

  render(candidates: RouteCandidate[], idx: GtfsIndex, departureMin: number) {
    this.opts.container.innerHTML = '';
    if (candidates.length === 0) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = '経路が見つかりません。日時または地点を変えて再検索してください。';
      this.opts.container.appendChild(p);
      return;
    }

    candidates.forEach((c, i) => {
      const card = document.createElement('div');
      card.className = 'result-card';
      card.dataset.index = String(i);

      const totalMin = c.arrivalMin - departureMin;
      const rideCount = c.legs.filter((l) => l.kind === 'ride').length;
      const fare = rideCount * 100;

      const head = document.createElement('h3');
      head.textContent = `${formatMin(departureMin)} → ${formatMin(c.arrivalMin)}（所要 ${totalMin}分・乗換 ${c.transfers}回・運賃 ${fare}円）`;
      card.appendChild(head);

      for (const leg of c.legs) {
        const row = document.createElement('div');
        row.className = 'result-leg';
        if (leg.kind === 'ride') {
          const fromName = idx.stopById.get(leg.fromStopId)?.stop_name ?? leg.fromStopId;
          const toName = idx.stopById.get(leg.toStopId)?.stop_name ?? leg.toStopId;
          const routeName = leg.route_id ? idx.routeById.get(leg.route_id)?.route_long_name ?? '' : '';
          row.textContent = `🚌 ${formatMin(leg.fromMin)} ${fromName} → ${formatMin(leg.toMin)} ${toName}${routeName ? `（${routeName}）` : ''}`;
        } else {
          row.textContent = `🚶 ${formatMin(leg.fromMin)} → ${formatMin(leg.toMin)}（徒歩 ${leg.toMin - leg.fromMin}分）`;
        }
        card.appendChild(row);
      }

      card.addEventListener('click', () => {
        this.select(i);
        this.opts.onSelect(i, c);
      });
      this.opts.container.appendChild(card);
    });

    this.select(0);
    this.opts.onSelect(0, candidates[0]);
  }

  private select(i: number) {
    for (const el of this.opts.container.querySelectorAll('.result-card')) {
      el.classList.toggle('selected', Number((el as HTMLElement).dataset.index) === i);
    }
  }

  clear() {
    this.opts.container.innerHTML = '';
  }
}
