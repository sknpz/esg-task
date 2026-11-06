import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumoDeBateria, consumirSilencio, rodadaMudou, silencioDoCenarioMs } from '../src/relogio.ts';

test('pausado não gasta bateria', () => {
  assert.equal(consumoDeBateria(false, true, 1, 250), 0);
  assert.equal(consumoDeBateria(true, true, 2, 250), 0);
});

test('2x gasta o dobro', () => {
  assert.equal(consumoDeBateria(true, false, 2, 250), 2 * consumoDeBateria(true, false, 1, 250));
  assert.ok(consumoDeBateria(true, false, 1, 250) > consumoDeBateria(false, false, 1, 250));
});

test('silêncio do cenário em tempo simulado', () => {
  assert.equal(silencioDoCenarioMs(45), 70_000);
});

test('silêncio: pausado não consome; 2x consome o dobro', () => {
  assert.equal(consumirSilencio(10_000, true, 1, 250), 10_000);
  assert.equal(consumirSilencio(10_000, true, 2, 250), 10_000);
  assert.equal(consumirSilencio(10_000, false, 1, 250), 9_750);
  assert.equal(consumirSilencio(10_000, false, 2, 250), 9_500);
  assert.equal(consumirSilencio(undefined, false, 2, 250), undefined);
});

test('rodadaMudou só vale quando já havia uma rodada vista', () => {
  assert.equal(rodadaMudou(undefined, 1), false);
  assert.equal(rodadaMudou(1, 1), false);
  assert.equal(rodadaMudou(1, 2), true);
});
