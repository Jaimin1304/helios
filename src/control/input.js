/**
 * Mouse and keyboard bindings, deliberately shaped like Blender's: middle button pans,
 * right button orbits, wheel zooms, double-click flies to a body, and a middle click
 * while focused releases it.
 */
export function attachInput(canvas, rig, hooks) {
  const drag = { button: -1, x: 0, y: 0, moved: 0 };

  const stop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  canvas.addEventListener('contextmenu', stop);
  canvas.addEventListener('auxclick', stop);

  canvas.addEventListener('pointerdown', (e) => {
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
