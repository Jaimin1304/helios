import { AU_KM, TIME_SCALES } from '../config.js';
import { formatUnit } from '../render/grid.js';
import { LANG, T } from '../i18n.js';

function fmtDistance(km) {
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  if (km < 1e6) return `${km.toLocaleString('en-US', { maximumFractionDigits: 0 })} km`;
  const au = km / AU_KM;
  if (au < 0.01) return T.millionKm((km / 1e6).toFixed(2));
  return `${au.toFixed(au < 10 ? 4 : 3)} AU`;
}

function fmtRadius(km) {
  return km >= 100
    ? `${km.toLocaleString('en-US', { maximumFractionDigits: 0 })} km`
    : `${km.toFixed(1)} km`;
}

function fmtPeriod(days) {
  if (!days) return T.none;
  const d = Math.abs(days);
  if (d < 1) return T.hours((d * 24).toFixed(2));
  if (d < 400) return T.days(d.toFixed(2));
  return T.years((d / 365.25).toFixed(d / 365.25 < 100 ? 2 : 0));
}

/** Rotation period: hours read better below two days. Retrograde and synchronous get tagged. */
function fmtSpin(body) {
  const d = body.rotationDays;
  if (!d) return T.none;
  const main = d < 2 ? T.hours((d * 24).toFixed(2)) : fmtPeriod(d);
  const tags = [];
  if (body.retrograde) tags.push(T.retrograde);
  if (body.synchronous) tags.push(T.tidalLock);
  return tags.length ? T.spinTags(main, tags) : main;
}

function fmtGravity(g) {
  if (g === null) return T.none;
  if (g >= 0.1) return `${g.toFixed(2)} m/s²`;
  if (g >= 0.001) return `${g.toFixed(4)} m/s²`;
  return `${(g * 1000).toFixed(3)} mm/s²`;
}

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.chip = document.getElementById('mode-chip');
    this.gridChip = document.getElementById('grid-chip');
    this.clockChip = document.getElementById('clock-chip');
    this.lagrangeChip = document.getElementById('lagrange-chip');
    this.info = document.getElementById('info');
    this.infoName = document.getElementById('info-name');
    this.infoEn = document.getElementById('info-en');
    this.rows = document.getElementById('info-rows');
    this.loading = document.getElementById('loading');
    this.loaderFill = document.getElementById('loader-fill');
    this.loaderMsg = document.getElementById('loader-msg');
    this.uiHidden = false;
    this._mode = null;
    this._body = null;
  }

  progress(frac, msg) {
    this.loaderFill.style.width = `${(frac * 100).toFixed(1)}%`;
    if (msg) this.loaderMsg.textContent = msg;
  }

  finishLoading() {
    this.loading.classList.add('done');
    setTimeout(() => this.loading.remove(), 700);
  }

  /** H: collapse or restore the whole interface, leaving only the HELIOS mark */
  toggleUi() {
    this.uiHidden = !this.uiHidden;
    this.root.classList.toggle('ui-hidden', this.uiHidden);
  }

  setMode(mode, body) {
    const text = mode === 'focus' ? T.modeFocus(body?.name ?? '')
      : mode === 'flying' ? T.modeFlying
        : T.modeFree;
    if (this._mode !== text) {
      this._mode = text;
      this.chip.textContent = text;
      this.chip.classList.toggle('focus', mode === 'focus');
    }
  }

  /**
   * Simulation clock (UTC) and time-lapse rate. The rate is followed by what it means,
   * because 43200x and 525600x say nothing about speed on their own.
   */
  setClock(date, index) {
    const p = (n) => String(n).padStart(2, '0');
    const text = `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`
      + ` ${p(date.getUTCHours())}:${p(date.getUTCMinutes())} UTC`
      + ` · ${TIME_SCALES[index]}× · ${T.timeRates[index]}`;
    if (this._clock !== text) {
      this._clock = text;
      this.clockChip.textContent = text;
    }
  }

  /** Lagrange points. The number of visible groups is reported too, because zooming out
   *  hides every group and without the count that looks like a broken feature. */
  setLagrange(on, count) {
    const text = on ? T.lagrangeChip(count) : null;
    if (this._lagrange === text) return;
    this._lagrange = text;
    this.lagrangeChip.classList.toggle('hidden', !on);
    if (on) this.lagrangeChip.textContent = text;
  }

  /** Ecliptic frame: current mode and cell size */
  setGrid(mode, unitKm) {
    if (mode === 'off') {
      this.gridChip.classList.add('hidden');
      this._grid = null;
      return;
    }
    const text = T.gridChip(mode === 'rect' ? T.gridRect : T.gridPolar, formatUnit(unitKm));
    if (this._grid !== text) {
      this._grid = text;
      this.gridChip.textContent = text;
      this.gridChip.classList.remove('hidden');
    }
  }

  setBody(body, camDistKm) {
    if (!body) {
      this.info.classList.add('hidden');
      this._body = null;
      return;
    }
    this.info.classList.remove('hidden');
    if (this._body !== body) {
      this._body = body;
      this.infoName.textContent = body.name;
      this.infoName.style.color = body.theme;
      // In Chinese the subtitle carries the English name. In English the title already is
      // the English name, so the subtitle stays empty.
      this.infoEn.textContent = LANG === 'zh' ? body.def.en : '';
    }
    const rows = [
      [T.rowType, T.kind[body.kind] ?? body.kind],
      [T.rowRadius, fmtRadius(body.radius)],
      [T.rowGravity, fmtGravity(body.surfaceGravity)],
      [T.rowSpin, fmtSpin(body)],
      [T.rowParent, body.parent ? body.parent.name : T.none],
      [T.rowSemiMajor, body.orbit ? fmtDistance(body.orbit.a) : T.none],
      [T.rowPeriod, fmtPeriod(body.orbit?.period)],
      [T.rowSunDist, fmtDistance(body.sunDistance)],
      [T.rowCamDist, fmtDistance(camDistKm)],
    ];
    this.rows.innerHTML = rows
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join('');
  }
}
