import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumoDeBateria, consumirSilencio, FATOR_BATERIA_REAL, rodadaMudou, silencioDoCenarioMs } from '../src/relogio.ts';

test('pausado não gasta bateria', () => {
  assert.equal(consumoDeBateria(false, true, 1, 250, 'DEMO'), 0);
  assert.equal(consumoDeBateria(true, true, 2, 250, 'DEMO'), 0);
});

test('2x gasta o dobro', () => {
  assert.equal(consumoDeBateria(true, false, 2, 250, 'DEMO'), 2 * consumoDeBateria(true, false, 1, 250, 'DEMO'));
  assert.ok(consumoDeBateria(true, false, 1, 250, 'DEMO') > consumoDeBateria(false, false, 1, 250, 'DEMO'));
});

test('em tempo real a bateria gasta 1/60 do modo demonstração, e 2x dobra nos dois', () => {
  assert.equal(FATOR_BATERIA_REAL, 60);
  for (const mov of [true, false]) {
    const demo = consumoDeBateria(mov, false, 1, 250, 'DEMO');
    assert.ok(Math.abs(consumoDeBateria(mov, false, 1, 250, 'REAL') - demo / FATOR_BATERIA_REAL) < 1e-12);
    assert.ok(Math.abs(consumoDeBateria(mov, false, 2, 250, 'REAL') - (2 * demo) / FATOR_BATERIA_REAL) < 1e-12);
  }
  assert.equal(consumoDeBateria(true, true, 1, 250, 'REAL'), 0);
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
