import type { GtfsIndex } from '../data/indexer.js';
import type { RouteCandidate } from '../routing/raptor.js';
import { formatMin } from '../util/time.js';

export interface ResultPanelOptions {
  container: HTMLElement;
  onSelect: (index: number, candidate: RouteCandidate) => void;
  onStopClick: (stopId: string) => void;
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

      const userArrival = c.arrivalMin;
      const userTotalMin = userArrival - departureMin;
      const rideLegs = c.legs.filter((l) => l.kind === 'ride');
      const fare = rideLegs.length * 100;

      const head = document.createElement('h3');
      head.textContent = `${formatMin(departureMin)} → ${formatMin(userArrival)}（所要 ${userTotalMin}分・乗換 ${c.transfers}回・運賃 ${fare}円）`;
      card.appendChild(head);

      const firstBoard = rideLegs[0]
        ? idx.stopById.get(rideLegs[0].fromStopId)
        : undefined;
      const lastAlight = rideLegs[rideLegs.length - 1]
        ? idx.stopById.get(rideLegs[rideLegs.length - 1].toStopId)
        : undefined;

      if (firstBoard) {
        const stopRow = document.createElement('div');
        stopRow.className = 'result-stop';
        stopRow.textContent = `🚏 出発バス停: ${firstBoard.stop_name}（徒歩${c.originWalkMin}分）`;
        card.appendChild(stopRow);
      }
      if (lastAlight) {
        const stopRow = document.createElement('div');
        stopRow.className = 'result-stop';
        stopRow.textContent = `🚏 到着バス停: ${lastAlight.stop_name}（徒歩${c.destWalkMin}分）`;
        card.appendChild(stopRow);
      }

      // Origin walk
      if (c.originWalkMin > 0 && firstBoard) {
        const w = document.createElement('div');
        w.className = 'result-leg';
        w.textContent = `🚶 ${formatMin(departureMin)} → ${formatMin(departureMin + c.originWalkMin)}（出発地から徒歩${c.originWalkMin}分）`;
        card.appendChild(w);
      }

      for (const leg of c.legs) {
        const row = document.createElement('div');
        row.className = 'result-leg';
        if (leg.kind === 'ride') {
          const fromName = idx.stopById.get(leg.fromStopId)?.stop_name ?? leg.fromStopId;
          const toName = idx.stopById.get(leg.toStopId)?.stop_name ?? leg.toStopId;
          const routeName = leg.route_id
            ? idx.routeById.get(leg.route_id)?.route_long_name ?? ''
            : '';
          row.textContent = `🚌 ${formatMin(leg.fromMin)} ${fromName} → ${formatMin(leg.toMin)} ${toName}${routeName ? `（${routeName}）` : ''}`;
          card.appendChild(row);

          // Collapsible list of intermediate stops for this ride leg.
          const intermediateIds = leg.intermediateStopIds ?? [];
          if (intermediateIds.length > 0) {
            const det = document.createElement('details');
            det.className = 'via-stops';
            const sum = document.createElement('summary');
            sum.textContent = `経由バス停（${intermediateIds.length}停留所）`;
            det.appendChild(sum);
            const list = document.createElement('ul');
            for (const sid of intermediateIds) {
              const s = idx.stopById.get(sid);
              if (!s) continue;
              const li = document.createElement('li');
              const a = document.createElement('a');
              a.className = 'via-stop-link';
              a.href = '#';
              a.textContent = s.stop_name;
              a.dataset.stopId = sid;
              a.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.opts.onStopClick(sid);
              });
              li.appendChild(a);
              list.appendChild(li);
            }
            det.appendChild(list);
            card.appendChild(det);
          }
        } else {
          const fromName = idx.stopById.get(leg.fromStopId)?.stop_name ?? leg.fromStopId;
          const toName = idx.stopById.get(leg.toStopId)?.stop_name ?? leg.toStopId;
          row.textContent = `🚶 ${formatMin(leg.fromMin)} ${fromName} → ${formatMin(leg.toMin)} ${toName}（徒歩${leg.toMin - leg.fromMin}分）`;
          card.appendChild(row);
        }
      }

      // Destination walk
      if (c.destWalkMin > 0 && lastAlight) {
        const lastRideEnd = rideLegs[rideLegs.length - 1]?.toMin ?? c.arrivalMin;
        const w = document.createElement('div');
        w.className = 'result-leg';
        w.textContent = `🚶 ${formatMin(lastRideEnd)} → ${formatMin(lastRideEnd + c.destWalkMin)}（バス停から徒歩${c.destWalkMin}分）`;
        card.appendChild(w);
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
