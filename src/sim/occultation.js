/**
 * Visible fraction of a circular light source after another circular disc crosses it.
 * Radii and separation only need to share a unit; angular radians are used by the renderer.
 */
export function discVisibility(sourceRadius, occluderRadius, separation) {
  if (!(sourceRadius > 0) || !(occluderRadius > 0)) return 1;
  if (separation >= sourceRadius + occluderRadius) return 1;
  if (separation <= Math.abs(sourceRadius - occluderRadius)) {
    const covered = Math.min(sourceRadius, occluderRadius);
    return 1 - (covered * covered) / (sourceRadius * sourceRadius);
  }

  const d2 = separation * separation;
  const sr2 = sourceRadius * sourceRadius;
  const or2 = occluderRadius * occluderRadius;
  const clampCos = (value) => Math.max(-1, Math.min(1, value));
  const sourceAngle = Math.acos(clampCos(
    (d2 + sr2 - or2) / (2 * separation * sourceRadius),
  ));
  const occluderAngle = Math.acos(clampCos(
    (d2 + or2 - sr2) / (2 * separation * occluderRadius),
  ));
  const lens = sr2 * sourceAngle + or2 * occluderAngle - 0.5 * Math.sqrt(Math.max(0,
    (-separation + sourceRadius + occluderRadius)
    * (separation + sourceRadius - occluderRadius)
    * (separation - sourceRadius + occluderRadius)
    * (separation + sourceRadius + occluderRadius)));
  return Math.max(0, Math.min(1, 1 - lens / (Math.PI * sr2)));
}
