import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avancar, gerarLitros, indicesDasParadas, montarEncontradas, passoDoRoteiro, simplificarTrajeto } from '../src/furgoes.ts';
import type { Ponto } from '../src/percurso.ts';

/** Sorteio previsível (LCG) para os testes estatísticos. */
function sorteio(semente = 42) {
  let s = semente;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

test('gerarLitros fica entre 0 e a capacidade e perto do esperado na maioria das vezes', () => {
  const rnd = sorteio();
  const n = 2400;
  let perto = 0;
  let bemAbaixo = 0;
  for (let i = 0; i < n; i++) {
    const l = gerarLitros(40, 50, rnd);
    assert.ok(Number.isInteger(l) && l >= 0 && l <= 50, `fora da faixa: ${l}`);
    if (l >= 34 && l <= 46) perto++;
    if (l < 16) bemAbaixo++;
  }
  // ~11/12 em torno do esperado (±15%) e ~1/12 abaixo de 40% dele (para a RN18 aparecer).
  assert.ok(perto / n > 0.85, `perto: ${perto}`);
  assert.ok(bemAbaixo / n > 0.05 && bemAbaixo / n < 0.12, `bem abaixo: ${bemAbaixo}`);
  // Esperado acima da capacidade: limitado a ela.
  for (let i = 0; i < 100; i++) assert.ok(gerarLitros(70, 50, rnd) <= 50);
});

test('gerarLitros sem histórico usa 70% da capacidade', () => {
  assert.equal(gerarLitros(null, 200, () => 0.5), 140);
  const rnd = sorteio(7);
  for (let i = 0; i < 500; i++) {
    const l = gerarLitros(null, 200, rnd);
    assert.ok(Number.isInteger(l) && l >= 119 && l <= 161, `fora de 70% ± 15%: ${l}`);
  }
});

test('passoDoRoteiro: rota longa termina no tempo alvo; curta usa o passo base', () => {
  const tempo = { duracaoS: 90, pausaMs: 1000, tickMs: 250 };
  // 10 paradas: 90 s − 10 s de pausas = 80 s = 320 ticks.
  assert.equal(passoDoRoteiro(160_000, 25, 10, tempo), 500);
  assert.equal(passoDoRoteiro(1_000, 25, 10, tempo), 25);
  // Sem paradas, o alvo inteiro.
  assert.equal(passoDoRoteiro(90_000, 25, 0, tempo), 250);
  // Pausas que comem o tempo todo: ao menos 1 tick.
  assert.equal(passoDoRoteiro(5_000, 25, 200, tempo), 5_000);
});

test('indicesDasParadas acha o ponto mais próximo de cada parada, em ordem', () => {
  // Vai para o leste por 0..10 e volta pelo mesmo caminho: cada parada é achada na ida, não na volta.
  const ida: Ponto[] = Array.from({ length: 11 }, (_, i) => ({ lat: 0, lng: i * 0.001 }));
  const rota = [...ida, ...ida.slice(0, -1).reverse()];
  const paradas = [
    { lat: 0.0001, lng: 0.0031 },
    { lat: -0.0001, lng: 0.0072 },
    { lat: 0, lng: 0.01 },
  ];
  assert.deepEqual(indicesDasParadas(rota, paradas), [3, 7, 10]);
  // Duas paradas no mesmo lugar: o mesmo índice, nunca para trás.
  assert.deepEqual(indicesDasParadas(rota, [paradas[1], paradas[1], paradas[0]]), [7, 7, 17]);
});

test('simplificarTrajeto mantém as pontas, os pontos das paradas e o limite', () => {
  const pontos: Ponto[] = Array.from({ length: 10_001 }, (_, i) => ({ lat: -23.6 - i * 1e-5, lng: -52.6 + i * 1.3e-5 }));
  const fixos = [1234, 5001, 9876];
  const s = simplificarTrajeto(pontos, fixos, 2000);
  assert.ok(s.length <= 2000);
  assert.deepEqual(s[0], [pontos[0].lat, pontos[0].lng].map((v) => Math.round(v * 1e6) / 1e6));
  const ultimo = pontos[pontos.length - 1];
  assert.deepEqual(s[s.length - 1], [ultimo.lat, ultimo.lng].map((v) => Math.round(v * 1e6) / 1e6));
  for (const i of fixos) {
    const p = [pontos[i].lat, pontos[i].lng].map((v) => Math.round(v * 1e6) / 1e6);
    assert.ok(s.some((q) => q[0] === p[0] && q[1] === p[1]), `faltou o ponto ${i}`);
  }
  // Cabe no limite de 64 kB do corpo com folga.
  assert.ok(JSON.stringify({ pontos: s, distanciaM: 123_456 }).length < 60_000);
  // Curto: vai inteiro.
  assert.equal(simplificarTrajeto(pontos.slice(0, 50), [10], 2000).length, 50);
});

test('avancar anda pelo caminho e para no limite (a parada), sem passar dele', () => {
  const pontos: Ponto[] = Array.from({ length: 5 }, (_, i) => ({ lat: 0, lng: i * 0.001 })); // ~111 m entre pontos
  const meio = avancar(pontos, pontos[0], 1, 50, 4);
  assert.equal(meio.chegou, false);
  assert.equal(meio.proximo, 1);
  assert.ok(Math.abs(meio.posicao.lng - 0.00045) < 1e-6);
  // Passo grande, limite no ponto 2: para nele, mesmo sobrando passo.
  const parada = avancar(pontos, pontos[0], 1, 10_000, 2);
  assert.deepEqual([parada.chegou, parada.proximo, parada.posicao], [true, 3, pontos[2]]);
});

test('montarEncontradas leva as procuradas que estão lá, com a capacidade de cada uma pelo código', () => {
  const parada = {
    litrosEsperados: null,
    procuradas: [
      { codigo: 'BO-0001', capacidadeL: 50 },
      { codigo: 'BO-0002', capacidadeL: 200 },
    ],
  };
  const meio = () => 0.5; // sem variação: 70% da capacidade
  assert.deepEqual(montarEncontradas(parada, (c) => c === 'BO-0002', meio), [{ codigo: 'BO-0002', litros: 140 }]);
  assert.deepEqual(montarEncontradas(parada, () => true, meio), [
    { codigo: 'BO-0001', litros: 35 },
    { codigo: 'BO-0002', litros: 140 },
  ]);
  assert.deepEqual(montarEncontradas(parada, () => false, meio), []);
});
