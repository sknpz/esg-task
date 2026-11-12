import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cliente } from '../src/api.ts';
import { filtrarClientes, proximaOrdem, type FiltroClientes } from '../src/filtroClientes.ts';

const cli = (parcial: Partial<Cliente>): Cliente => ({
  id: 0,
  nome: 'Cliente',
  tipo: 'Restaurante',
  cidade: 'Cianorte',
  endereco: 'Rua X, 1',
  lat: 0,
  lng: 0,
  raioM: 150,
  bombonas: 0,
  incidentes: 0,
  ultimoIncidente: null,
  risco: 'BAIXO',
  contratoAtivo: true,
  modalidade: 'SEMANAL',
  ...parcial,
});
const vazio: FiltroClientes = { busca: '', riscos: [], modalidades: [], ordem: null };
const ids = (lista: Cliente[]) => lista.map((c) => c.id);

test('pesquisa ignora acento, maiúscula e espaços nas pontas, em nome, cidade e endereço', () => {
  const lista = [cli({ id: 1, cidade: 'São Paulo' }), cli({ id: 2, nome: 'Pastelaria Japonês' }), cli({ id: 3, endereco: 'Rua Pará, 1' })];
  const busca = (texto: string) => ids(filtrarClientes(lista, { ...vazio, busca: texto }));
  assert.deepEqual(busca('  sao PAULO '), [1]);
  assert.deepEqual(busca('japones'), [2]);
  assert.deepEqual(busca('para'), [3]);
  assert.deepEqual(busca(''), [1, 2, 3]);
});

test('OU dentro do grupo, E entre grupos; "SEM" pega quem não tem contrato', () => {
  const lista = [
    cli({ id: 1, risco: 'ALTO', modalidade: 'SEMANAL' }),
    cli({ id: 2, risco: 'BAIXO', modalidade: null, contratoAtivo: false }),
    cli({ id: 3, risco: 'ALTO', modalidade: 'MENSAL' }),
  ];
  assert.deepEqual(ids(filtrarClientes(lista, { ...vazio, riscos: ['ALTO'], modalidades: ['SEMANAL', 'SEM'] })), [1]);
  assert.deepEqual(ids(filtrarClientes(lista, { ...vazio, modalidades: ['SEM'] })), [2]);
  assert.deepEqual(ids(filtrarClientes(lista, { ...vazio, riscos: ['ALTO', 'BAIXO'] })), [1, 2, 3]);
});

test('ordem por bombonas: DESC, ASC e null mantém a ordem recebida; empate mantém a ordem recebida', () => {
  const lista = [cli({ id: 1, bombonas: 2 }), cli({ id: 2, bombonas: 5 }), cli({ id: 3, bombonas: 2 })];
  assert.deepEqual(ids(filtrarClientes(lista, { ...vazio, ordem: 'DESC' })), [2, 1, 3]);
  assert.deepEqual(ids(filtrarClientes(lista, { ...vazio, ordem: 'ASC' })), [1, 3, 2]);
  assert.deepEqual(ids(filtrarClientes(lista, vazio)), [1, 2, 3]);
  assert.deepEqual(ids(lista), [1, 2, 3]); // não altera a lista recebida
});

test('proximaOrdem alterna DESC → ASC → null → DESC', () => {
  assert.deepEqual([proximaOrdem(null), proximaOrdem('DESC'), proximaOrdem('ASC')], ['DESC', 'ASC', null]);
});
