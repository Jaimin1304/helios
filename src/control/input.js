/**
 * Pointer and keyboard bindings. Mouse controls are deliberately shaped like Blender's;
 * touch uses one finger to orbit and two fingers to pan/zoom.
 */
export function attachInput(canvas, rig, hooks) {
  const drag = { button: -1, x: 0, y: 0, moved: 0 };
  const touches = new Map();
  let gesture = null;
  let touchMoved = 0;
  let touchHadMultiple = false;
  let lastTap = null;

  const touchMetrics = () => {
    const points = [...touches.values()];
    if (!points.length) return null;
    if (points.length === 1) return { count: 1, x: points[0].x, y: points[0].y, distance: 0 };
    const [a, b] = points;
    return {
      count: 2,
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };

  const stop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  canvas.addEventListener('contextmenu', stop);
  canvas.addEventListener('auxclick', stop);

  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus({ preventScroll: true });
    if (e.pointerType === 'touch') {
      stop(e);
      canvas.setPointerCapture(e.pointerId);
      if (touches.size === 0) {
        touchMoved = 0;
        touchHadMultiple = false;
        if (rig.mode === 'free') rig.snapPivotToEcliptic();
      }
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      touchHadMultiple ||= touches.size > 1;
      gesture = touchMetrics();
      canvas.classList.add('grabbing');
      return;
    }
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    if (e.button === 1) e.preventDefault(); // suppress Windows middle-click autoscroll
    canvas.setPointerCapture(e.pointerId);
    drag.button = e.button;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved = 0;

    // The instant the right button goes down, fix the pivot at the intersection of the
    // view-centre ray with the ecliptic plane
    if (e.button === 2 && rig.mode === 'free') rig.snapPivotToEcliptic();
    if (e.button !== 0) canvas.classList.add('grabbing');
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      const point = touches.get(e.pointerId);
      if (!point) return;
      stop(e);
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const next = touchMetrics();
      if (gesture?.count === next.count) {
        const dx = next.x - gesture.x;
        const dy = next.y - gesture.y;
        touchMoved += Math.abs(dx) + Math.abs(dy);
        if (!rig.busy && next.count === 1) {
          rig.orbit(dx, dy);
        } else if (!rig.busy && next.count === 2) {
          if (rig.mode === 'free') rig.pan(dx, dy, canvas.clientHeight);
          rig.zoom((gesture.distance - next.distance) * 2.2);
        }
      }
      gesture = next;
      return;
    }
    if (drag.button < 0) {
      hooks.onHover?.(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);

    if (drag.button === 1) {
      // Middle drag: if focused or in flight, release at once and carry straight on panning
      if (rig.mode !== 'free') hooks.onRelease();
      rig.pan(dx, dy, canvas.clientHeight);
    } else if (drag.button === 2) {
      if (rig.busy) return;
      rig.orbit(dx, dy);
    }
  });

  const endDrag = (e) => {
    if (e.pointerType === 'touch') {
      if (!touches.has(e.pointerId)) return;
      stop(e);
      touches.delete(e.pointerId);
      gesture = touchMetrics();
      if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (touches.size === 0) {
        canvas.classList.remove('grabbing');
        if (e.type === 'pointerup' && !touchHadMultiple && touchMoved <= 8) {
          const body = hooks.pick(e.clientX, e.clientY);
          const now = performance.now();
          const doubleTap = body && lastTap?.body === body && now - lastTap.time <= 360
            && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= 28;
          if (doubleTap) {
            hooks.onFocus(body);
            lastTap = null;
          } else {
            hooks.onSelect(body);
            lastTap = body ? { body, time: now, x: e.clientX, y: e.clientY } : null;
          }
        }
      }
      return;
    }
    if (drag.button < 0) return;
    const btn = drag.button;
    const moved = drag.moved;
    drag.button = -1;
    canvas.classList.remove('grabbing');
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

    if (moved > 5) return; // a drag, not a click
    if (btn === 1) {
      // Middle click releases focus
      if (rig.mode !== 'free') hooks.onRelease();
    } else if (btn === 0) {
      hooks.onSelect(hooks.pick(e.clientX, e.clientY));
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('dblclick', (e) => {
    const body = hooks.pick(e.clientX, e.clientY);
    if (body) hooks.onFocus(body);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (rig.busy) return;
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 16; // lines
    else if (e.deltaMode === 2) d *= 100; // pages
    rig.zoom(Math.max(-260, Math.min(260, d)));
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.repeat) return; // toggles should advance once per physical key press
    switch (e.key.toLowerCase()) {
      case 'escape': hooks.onRelease(); break;
      case 'o': hooks.onToggle('orbits'); break;
      case 'n': hooks.onToggle('labels'); break;
      case 'l': hooks.onToggle('lagrange'); break;
      case 'g': hooks.onToggle('grid'); break;
      case 't': hooks.onToggle('time'); break;
      case 'h': hooks.onToggle('ui'); break;
      case 'f': hooks.onFocusSelected(); break;
      default: break;
    }
  });
}
