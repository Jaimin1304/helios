import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Vector3 } from 'three';
import { BODIES } from '../src/data/bodies.js';
import { compileOrbit, orbitPosition, solveKepler } from '../src/sim/kepler.js';
import { discVisibility } from '../src/sim/occultation.js';

test('Kepler solver satisfies M = E - e sin(E) through high eccentricity', () => {
  for (const eccentricity of [0, 0.3, 0.79, 0.95]) {
    for (const meanAnomaly of [-3, -1, 0, 0.7, 2.9]) {
      const eccentricAnomaly = solveKepler(meanAnomaly, eccentricity);
      const residual = eccentricAnomaly
        - eccentricity * Math.sin(eccentricAnomaly)
        - meanAnomaly;
      assert.ok(Math.abs(residual) < 1e-12, `residual ${residual} at e=${eccentricity}`);
    }
  }
});

test('compiled Kepler orbit is periodic and preserves periapsis distance', () => {
  const elements = { a: 1000, e: 0.4, i: 17, node: 31, peri: 67, M0: 0, period: 20 };
  const orbit = compileOrbit(elements);
  const start = orbitPosition(orbit, 0, new Vector3());
  const onePeriod = orbitPosition(orbit, elements.period, new Vector3());
  assert.ok(start.distanceTo(onePeriod) < 1e-9);
  assert.ok(Math.abs(start.length() - elements.a * (1 - elements.e)) < 1e-9);
});

test('finite-disc visibility handles total, annular and partial eclipses', () => {
  assert.equal(discVisibility(1, 1, 2), 1);
  assert.equal(discVisibility(1, 2, 0), 0);
  assert.equal(discVisibility(2, 1, 0), 0.75);

  const equalDiscsHalfRadiusApart = discVisibility(1, 1, 1);
  const expected = 1 - (2 * Math.acos(0.5) - Math.sqrt(3) / 2) / Math.PI;
  assert.ok(Math.abs(equalDiscsHalfRadiusApart - expected) < 1e-12);
});

test('every body has a dedicated surface map and every declared source file exists', () => {
  const missing = BODIES.filter((definition) => !definition.tex?.map).map(({ id }) => id);
  assert.deepEqual(missing, []);

  const absentFiles = BODIES
    .filter(({ tex }) => !existsSync(resolve(import.meta.dirname, '..', tex.map.replace('./', ''))))
    .map(({ id }) => id);
  assert.deepEqual(absentFiles, []);
});

test('AI-assisted texture sources are explicitly labelled', () => {
  const generated = BODIES.filter(({ tex }) => tex.map.includes('_generated.'));
  assert.equal(generated.length, 26);
  assert.ok(generated.every(({ tex }) => tex.map.startsWith('./solar_textures/2k_')));
});

test('body definitions contain no legacy procedural-surface parameters', () => {
  const legacyKeys = ['style', 'craters', 'cracks', 'bands', 'spot'];
  const offenders = BODIES
    .filter((definition) => legacyKeys.some((key) => key in definition))
    .map(({ id }) => id);
  assert.deepEqual(offenders, []);
});
