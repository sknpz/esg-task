import assert from 'node:assert/strict';
import { test } from 'node:test';
import { posicaoDoAcompanhado, precisaZoom } from '../src/acompanhamento.ts';
import type { Ponto, Roteiro, StatusRoteiro } from '../src/api.ts';

const rot = (id: number, status: StatusRoteiro, posicao: Ponto | null): Roteiro => ({
  id,
  numero: id,
  status,
  distanciaM: null,
  trajeto: null,
  posicao,
  capacidade: 10,
  carga: 0,
  paradas: [],
});

test('posicaoDoAcompanhado só segue furgão em andamento e com posição', () => {
  const lista = [rot(1, 'EM_ANDAMENTO', { lat: 1, lng: 2 }), rot(2, 'CONCLUIDO', { lat: 3, lng: 4 }), rot(3, 'EM_ANDAMENTO', null), rot(4, 'PLANEJADO', null)];
  assert.deepEqual(posicaoDoAcompanhado(lista, 1), { lat: 1, lng: 2 });
  assert.equal(posicaoDoAcompanhado(lista, 2), null); // concluiu
  assert.equal(posicaoDoAcompanhado(lista, 3), null);
  assert.equal(posicaoDoAcompanhado(lista, 4), null);
  assert.equal(posicaoDoAcompanhado(lista, 9), null); // sumiu (reset, outro dia)
  assert.equal(posicaoDoAcompanhado(lista, null), null);
});

test('precisaZoom: ao ligar o acompanhamento e ao trocar de furgão; não a cada posição do mesmo', () => {
  assert.equal(precisaZoom(null, 1), true); // ligou
  assert.equal(precisaZoom(1, 1), false); // mesmo furgão: só recentraliza
  assert.equal(precisaZoom(1, 2), true); // trocou de furgão: zoom de rua de novo
  assert.equal(precisaZoom(1, null), false); // desligou
});
