import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Contrato } from '../src/api.ts';
import { erroDoFormulario, formularioDepoisDeSalvar, paraEntrada, vazio } from '../src/formularioContrato.ts';

const salvo: Contrato = {
  id: 50,
  clienteId: 51,
  cliente: { nome: 'Bar do Zé', cidade: 'Cianorte' },
  quantidade: 2,
  frequencia: 'SEMANAL',
  diasSemana: [3],
  diaMes: null,
  inicio: '2026-11-11',
  situacao: 'ATIVO',
  proximas: [],
};

test('depois de criar com cliente novo, o formulário edita o contrato criado sem pedir cliente', () => {
  // Aberto sem clientes sem contrato: clienteId null e cliente novo marcado.
  const criado = { ...vazio('2026-11-11'), novo: { nome: 'Bar do Zé', tipo: 'Bar', cidade: 'Cianorte', endereco: 'Rua A', ponto: { lat: 1, lng: 2 } } };
  assert.equal(erroDoFormulario(criado, true), null);
  const depois = formularioDepoisDeSalvar(salvo);
  assert.equal(erroDoFormulario({ ...depois, quantidade: '3' }, false), null);
  const entrada = paraEntrada({ ...depois, quantidade: '3' });
  assert.equal(entrada.clienteId, 51);
  assert.equal(entrada.novoCliente, undefined);
});

test('erroDoFormulario: cliente novo exige campos e ponto; cliente existente exige escolha', () => {
  const novo = vazio('2026-11-11');
  assert.equal(erroDoFormulario(novo, true), 'Preencha nome, tipo, cidade e endereço.');
  const semPonto = { ...novo, novo: { nome: 'A', tipo: 'Bar', cidade: 'C', endereco: 'R', ponto: null } };
  assert.equal(erroDoFormulario(semPonto, true), 'Marque no mapa onde o cliente fica.');
  assert.equal(erroDoFormulario({ ...novo, clienteNovo: false }, true), 'Escolha o cliente.');
});
