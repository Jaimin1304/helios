import { LABEL_MIN_SEP_PX } from '../config.js';

/**
 * 天体名称标签层。真实比例下绝大多数天体都是亚像素的，标签就是找到并点中
 * 它们的主要手段，所以这里做了几件事：
 *   1) 卫星与母天体在屏幕上分不开时不画，避免糊成一团；
 *   2) 按重要度做矩形防重叠（重要的先占位）；
 *   3) 标签本身 pointer-events:none —— 悬停在标签上不能妨碍平移/旋转/缩放，
 *      点击改由画布侧的 hitTest() 在屏幕空间处理。
 */
const PRIORITY = { star: 0, planet: 1, dwarf: 2, moon: 3, minor: 4 };

export class LabelLayer {
  constructor(container, bodies) {
    this.container = container;
    this.enabled = true;
    this.selectedId = null;
    this.hoveredId = null;
    this.entries = [];
    /** 本帧真正画出来的标签及其屏幕矩形，供拾取用 */
    this.placed = [];

    for (const body of bodies) {
      const el = document.createElement('div');
      el.className = `tag k-${body.kind}`;
      el.textContent = body.name;
      el.dataset.id = body.id;
      // 主题色走 CSS 变量而不是直接写 color，这样 .hovered/.selected 还能覆盖
      el.style.setProperty('--tc', body.theme);
      el.style.display = 'none';
      container.appendChild(el);
      this.entries.push({ body, el, width: 0, shown: false });
    }
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) {
      for (const e of this.entries) this.hide(e);
      this.placed.length = 0;
    }
  }

  setSelected(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    for (const e of this.entries) e.el.classList.toggle('selected', e.body.id === id);
  }

  setHovered(id) {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    for (const e of this.entries) e.el.classList.toggle('hovered', e.body.id === id);
  }

  /** 光标是否落在某个标签的文字块上 */
  hitTest(px, py) {
    for (const p of this.placed) {
      if (px >= p.x0 && px <= p.x1 && py >= p.y0 && py <= p.y1) return p.body;
    }
    return null;
  }

  hide(entry) {
    if (entry.shown) {
      entry.el.style.display = 'none';
      entry.shown = false;
    }
  }

  update(width, height) {
    if (!this.enabled) return;

    this.placed.length = 0;
    const candidates = [];

    for (const entry of this.entries) {
      const b = entry.body;
      const s = b.screen;
      if (!s.visible || s.occluded
        || s.x < -40 || s.x > width - 30 || s.y < 10 || s.y > height - 10) {
        this.hide(entry);
        continue;
      }
      // 卫星：和母天体在屏幕上贴太近就不标
      if (b.parent && b.parent.def.parent) {
        const p = b.parent.screen;
        const sep = Math.hypot(s.x - p.x, s.y - p.y);
        if (sep < Math.max(LABEL_MIN_SEP_PX, p.px * 0.75)) {
          this.hide(entry);
          continue;
        }
      }
      candidates.push(entry);
    }

    // 重要的先占位；同级里屏幕更大的优先
    candidates.sort((a, b) => {
      const d = PRIORITY[a.body.kind] - PRIORITY[b.body.kind];
      return d !== 0 ? d : b.body.screen.px - a.body.screen.px;
    });

    for (const entry of candidates) {
      const s = entry.body.screen;
      // 标签挂在天体右侧，大天体则贴着圆面边缘
      const offX = Math.min(Math.max(6, s.px * 0.75), 46);
      const x = s.x + offX;
      const y = s.y;

      if (!entry.width) {
        entry.el.style.display = 'flex';
        entry.width = entry.el.offsetWidth || 60;
      }
      const w = entry.width;
      const h = 15;
      const box = { x0: x, y0: y - h / 2, x1: x + w, y1: y + h / 2, body: entry.body };

      let clash = false;
      for (const p of this.placed) {
        if (box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0) {
          clash = true;
          break;
        }
      }
      if (clash) {
        this.hide(entry);
        continue;
      }
      this.placed.push(box);

      entry.el.style.transform = `translate3d(${x.toFixed(1)}px, ${(y - h / 2).toFixed(1)}px, 0)`;
      if (!entry.shown) {
        entry.el.style.display = 'flex';
        entry.shown = true;
      }
    }
  }
}
