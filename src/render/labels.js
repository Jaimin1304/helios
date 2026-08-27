import { LABEL_MIN_SEP_PX } from '../config.js';

/**
 * DOM label layer for body names. At true scale almost every body is sub-pixel, so labels are
 * the main way to find one and click it. Three things follow from that. A moon whose label
 * would collide with its primary is dropped rather than smeared over it. Labels claim screen
 * rectangles in order of importance, so the interesting ones survive a crowded view. And the
 * labels themselves are pointer-events:none, because hovering one must never block panning,
 * orbiting or zooming; clicks are resolved by hitTest() against the canvas in screen space.
 */
const PRIORITY = { star: 0, planet: 1, dwarf: 2, moon: 3, minor: 4 };

export class LabelLayer {
  constructor(container, bodies) {
    this.container = container;
    this.enabled = true;
    this.selectedId = null;
    this.hoveredId = null;
    this.entries = [];
    /** Labels actually drawn this frame plus their screen rectangles, used for picking */
    this.placed = [];

    for (const body of bodies) {
      const el = document.createElement('div');
      el.className = `tag k-${body.kind}`;
      el.textContent = body.name;
      el.dataset.id = body.id;
      // The theme colour goes through a CSS variable rather than color, so .hovered
      // and .selected can still override it
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

  /** Whether the cursor is over a label's text box */
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
      // Skip a moon's label when it sits too close to its primary on screen
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

    // Important bodies claim space first; within a tier, the larger on screen wins
    candidates.sort((a, b) => {
      const d = PRIORITY[a.body.kind] - PRIORITY[b.body.kind];
      return d !== 0 ? d : b.body.screen.px - a.body.screen.px;
    });

    for (const entry of candidates) {
      const s = entry.body.screen;
      // The label hangs to the right of the body, clearing the disc edge for large ones
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
