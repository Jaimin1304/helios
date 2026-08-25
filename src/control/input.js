/**
 * 鼠标 / 键盘绑定。刻意做成 Blender 风格：
 *   中键 = 平移，右键 = 旋转，滚轮 = 缩放，双击 = 飞抵聚焦，聚焦中点中键 = 退出。
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
    if (e.button === 1) e.preventDefault(); // 屏蔽 Windows 中键自动滚动
    canvas.setPointerCapture(e.pointerId);
    drag.button = e.button;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved = 0;

    // 右键按下的瞬间决定转轴：视口中心射线与黄道面的交点
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
      // 中键拖拽：聚焦中（或正在飞行）就先立刻解除，然后当场接着平移
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

    if (moved > 5) return; // 拖拽，不算点击
    if (btn === 1) {
      // 中键单击：解除聚焦
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
    if (e.deltaMode === 1) d *= 16; // 行
    else if (e.deltaMode === 2) d *= 100; // 页
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
