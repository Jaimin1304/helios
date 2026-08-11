import { AU_KM } from '../config.js';
import { formatUnit } from '../render/grid.js';

const GRID_NAME = { rect: '方格', polar: '极坐标' };

const KIND_NAME = {
  star: '恒星', planet: '行星', dwarf: '矮行星', moon: '卫星', minor: '小天体',
};

function fmtDistance(km) {
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  if (km < 1e6) return `${km.toLocaleString('en-US', { maximumFractionDigits: 0 })} km`;
  const au = km / AU_KM;
  if (au < 0.01) return `${(km / 1e6).toFixed(2)} 百万 km`;
  return `${au.toFixed(au < 10 ? 4 : 3)} AU`;
}

function fmtRadius(km) {
  return km >= 100
    ? `${km.toLocaleString('en-US', { maximumFractionDigits: 0 })} km`
    : `${km.toFixed(1)} km`;
}

function fmtPeriod(days) {
  if (!days) return '—';
  const d = Math.abs(days);
  if (d < 1) return `${(d * 24).toFixed(2)} 小时`;
  if (d < 400) return `${d.toFixed(2)} 天`;
  return `${(d / 365.25).toFixed(d / 365.25 < 100 ? 2 : 0)} 年`;
}

/** 自转周期：小于两天的用小时更直观，另标注逆行 / 同步自转 */
function fmtSpin(body) {
  const d = body.rotationDays;
  if (!d) return '—';
  const main = d < 2 ? `${(d * 24).toFixed(2)} 小时` : fmtPeriod(d);
  const tags = [];
  if (body.retrograde) tags.push('逆行');
  if (body.synchronous) tags.push('潮汐锁定');
  return tags.length ? `${main}（${tags.join(' · ')}）` : main;
}

function fmtGravity(g) {
  if (g === null) return '—';
  if (g >= 0.1) return `${g.toFixed(2)} m/s²`;
  if (g >= 0.001) return `${g.toFixed(4)} m/s²`;
  return `${(g * 1000).toFixed(3)} mm/s²`;
}

export class Hud {
  constructor() {
    this.chip = document.getElementById('mode-chip');
    this.gridChip = document.getElementById('grid-chip');
    this.clockChip = document.getElementById('clock-chip');
    this.info = document.getElementById('info');
    this.infoName = document.getElementById('info-name');
    this.infoEn = document.getElementById('info-en');
    this.rows = document.getElementById('info-rows');
    this.help = document.getElementById('help');
    this.loading = document.getElementById('loading');
    this.loaderFill = document.getElementById('loader-fill');
    this.loaderMsg = document.getElementById('loader-msg');
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

  toggleHelp() {
    this.help.classList.toggle('hidden');
  }

  setMode(mode, body) {
    const text = mode === 'focus' ? `聚焦 · ${body?.name ?? ''}`
      : mode === 'flying' ? '飞行中…'
        : '自由模式';
    if (this._mode !== text) {
      this._mode = text;
      this.chip.textContent = text;
      this.chip.classList.toggle('focus', mode === 'focus');
    }
  }

  /** 仿真时钟（UTC）与时间流逝倍率 */
  setClock(date, scale) {
    const p = (n) => String(n).padStart(2, '0');
    const text = `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`
      + ` ${p(date.getUTCHours())}:${p(date.getUTCMinutes())} UTC · ${scale}×`;
    if (this._clock !== text) {
      this._clock = text;
      this.clockChip.textContent = text;
    }
  }

  /** 黄道面坐标系：显示当前模式和格距 */
  setGrid(mode, unitKm) {
    if (mode === 'off') {
      this.gridChip.classList.add('hidden');
      this._grid = null;
      return;
    }
    const text = `黄道面 ${GRID_NAME[mode]} · 格距 ${formatUnit(unitKm)}`;
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
      this.infoEn.textContent = body.def.en;
    }
    const rows = [
      ['类型', KIND_NAME[body.kind] ?? body.kind],
      ['半径', fmtRadius(body.radius)],
      ['表面重力', fmtGravity(body.surfaceGravity)],
      ['自转周期', fmtSpin(body)],
      ['母天体', body.parent ? body.parent.name : '—'],
      ['轨道半长径', body.orbit ? fmtDistance(body.orbit.a) : '—'],
      ['公转周期', fmtPeriod(body.orbit?.period)],
      ['距太阳', fmtDistance(body.sunDistance)],
      ['距相机', fmtDistance(camDistKm)],
    ];
    this.rows.innerHTML = rows
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join('');
  }
}
