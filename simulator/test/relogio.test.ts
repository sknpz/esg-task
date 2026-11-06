import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumoDeBateria, estenderSilencio, rodadaMudou, silencioDoCenarioMs } from '../src/relogio.ts';

test('pausado não gasta bateria', () => {
  assert.equal(consumoDeBateria(false, true, 1, 250), 0);
  assert.equal(consumoDeBateria(true, true, 2, 250), 0);
});

test('2x gasta o dobro', () => {
  assert.equal(consumoDeBateria(true, false, 2, 250), 2 * consumoDeBateria(true, false, 1, 250));
  assert.ok(consumoDeBateria(true, false, 1, 250) > consumoDeBateria(false, false, 1, 250));
});

test('silêncio do cenário em 1x e em 2x', () => {
  assert.equal(silencioDoCenarioMs(45, 1), 70_000);
  assert.equal(silencioDoCenarioMs(45, 2), 35_000);
});

test('pausado, o silêncio ativo é estendido; fora disso fica igual', () => {
  assert.equal(estenderSilencio(10_000, true, 250), 10_250);
  assert.equal(estenderSilencio(10_000, false, 250), 10_000);
  assert.equal(estenderSilencio(undefined, true, 250), undefined);
});

test('rodadaMudou só vale quando já havia uma rodada vista', () => {
  assert.equal(rodadaMudou(undefined, 1), false);
  assert.equal(rodadaMudou(1, 1), false);
  assert.equal(rodadaMudou(1, 2), true);
});
