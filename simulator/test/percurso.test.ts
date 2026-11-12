import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comprimentoM, passoDaViagem, passoPorKmh } from '../src/percurso.ts';

test('passoPorKmh: 80 km/h a 250 ms anda ~5,56 m por tick', () => {
  assert.ok(Math.abs(passoPorKmh(80, 250) - 5.5556) < 0.001);
});

test('passoDaViagem: curta mantém a velocidade de sempre', () => {
  assert.equal(passoDaViagem(1_000, 25, 360), 25);
});

test('passoDaViagem: no limite, 90 s a 100 m/s', () => {
  assert.equal(passoDaViagem(9_000, 25, 360), 25);
});

test('passoDaViagem: longa termina em 90 s', () => {
  assert.equal(passoDaViagem(90_000, 25, 360), 250);
});

test('comprimentoM soma os trechos', () => {
  assert.equal(Math.round(comprimentoM([{ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 }, { lat: 0.02, lng: 0 }])), 2224);
});
