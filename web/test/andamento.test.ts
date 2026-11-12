import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Operacao, Roteiro, StatusRoteiro } from '../src/api.ts';
import { andamentoDoDia, fracaoDoTrajeto } from '../src/andamento.ts';

const iso = (ms: number) => new Date(ms).toISOString();
const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} não é ${b}`);

function op(parcial: Partial<Operacao>): Operacao {
  return { data: '2026-11-09', diaSemana: 1, fase: 'MANHA', pausado: false, velocidade: 1, modo: 'REAL', rodada: 1, dia: 1, faseDesde: iso(0), faseDuracaoMs: null, ...parcial };
}

function rot(status: StatusRoteiro): Roteiro {
  return { id: 1, numero: 1, status, distanciaM: null, trajeto: [[0, 0], [0, 1], [0, 2]], posicao: { lat: 0, lng: 0 }, capacidade: 10, carga: 0, paradas: [] };
}

test('manhã pela metade = 5%', () => perto(andamentoDoDia(op({ fase: 'MANHA', faseDesde: iso(0), faseDuracaoMs: 10_000 }), [], 5_000), 0.05));
test('rotas: um concluído e um parado no começo = 50%', () =>
  perto(andamentoDoDia(op({ fase: 'ROTAS', faseDuracaoMs: null }), [rot('CONCLUIDO'), rot('PLANEJADO')], 0), 0.5));
test('rotas sem roteiros = 90%', () => perto(andamentoDoDia(op({ fase: 'ROTAS', faseDuracaoMs: null }), [], 0), 0.9));
test('fim passado do prazo = 100%, sem passar de 1', () => assert.equal(andamentoDoDia(op({ fase: 'FIM', faseDesde: iso(0), faseDuracaoMs: 5_000 }), [], 9_000), 1));
test('posição no meio do trajeto = 0,5', () => perto(fracaoDoTrajeto([[0, 0], [0, 1], [0, 2]], { lat: 0, lng: 1 }).fracao, 0.5));
test('ida e volta: a partir do índice 2 acha o ponto da volta (0,75), não o da ida (0,25)', () => {
  const trajeto: [number, number][] = [[0, 0], [0, 1], [0, 2], [0, 1], [0, 0]];
  perto(fracaoDoTrajeto(trajeto, { lat: 0, lng: 1 }).fracao, 0.25);
  const volta = fracaoDoTrajeto(trajeto, { lat: 0, lng: 1 }, 2);
  perto(volta.fracao, 0.75);
  assert.equal(volta.indice, 3);
});

test('ida e volta pela mesma estrada: logo na saída a fração não salta para a volta', () => {
  // Ida de 0 a 0,1 grau de longitude e volta 5,5 m ao norte; a posição, logo depois do 1º ponto, fica mais perto de um
  // ponto da volta do que do próximo da ida.
  const ida: [number, number][] = Array.from({ length: 11 }, (_, k) => [0, k * 0.01]);
  const volta: [number, number][] = Array.from({ length: 11 }, (_, k) => [0.00005, 0.1 - k * 0.01]);
  const { fracao } = fracaoDoTrajeto([...ida, ...volta], { lat: 0.00005, lng: 0.0101 });
  assert.ok(fracao > 0 && fracao < 0.2, `fração ${fracao} deveria ficar perto de 0,05`);
});
