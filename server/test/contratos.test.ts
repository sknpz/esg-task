import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { criarContrato, dataOperacao, listarContratos } from '../src/contratos.ts';
import { abrirBanco, VERSAO_ESQUEMA } from '../src/db.ts';
import { estadoOperacao } from '../src/operacao.ts';
import { criarContexto, subirApi } from './apoio.ts';

const ctx = criarContexto();
let api: Awaited<ReturnType<typeof subirApi>>;
before(async () => (api = await subirApi(ctx)));
after(() => api.fechar());

const enviar = async (metodo: string, caminho: string, corpo?: unknown) => {
  const r = await fetch(`${api.url}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json() };
};
const post = (c: string, b: unknown) => enviar('POST', c, b);
const put = (c: string, b: unknown) => enviar('PUT', c, b);

let n = 0;
const clienteNovo = () =>
  Number(
    ctx.db
      .prepare("INSERT INTO clientes (nome, tipo, cidade, endereco, lat, lng) VALUES (?, 'x', 'Cianorte', 'rua', 0, 0)")
      .run(`Cliente de contrato ${++n}`).lastInsertRowid,
  );
const base = (clienteId: number) => ({ clienteId, quantidade: 2, frequencia: 'SEMANAL', diasSemana: [1], inicio: '2026-11-02' });

describe('contratos (RN19)', () => {
  it('cria contrato semanal e devolve as próximas datas', async () => {
    const c = await post('/contratos', base(clienteNovo()));
    assert.equal(c.status, 201);
    assert.deepEqual(c.corpo.proximas, ['2026-11-09', '2026-11-16', '2026-11-23']);
    assert.equal(c.corpo.situacao, 'ATIVO');
    assert.equal(c.corpo.cliente.cidade, 'Cianorte');
    const lido = await enviar('GET', `/contratos/${c.corpo.id}`);
    assert.equal(lido.corpo.id, c.corpo.id);
    const lista = await enviar('GET', '/contratos');
    assert.ok(lista.corpo.some((x: any) => x.id === c.corpo.id));
  });

  it('recusa segundo contrato ativo para o mesmo cliente (RN19)', async () => {
    const id = clienteNovo();
    assert.equal((await post('/contratos', base(id))).status, 201);
    assert.equal((await post('/contratos', base(id))).status, 409);
  });

  it('recusa quantidade < 1, cliente inexistente e regra inválida', async () => {
    assert.equal((await post('/contratos', { ...base(clienteNovo()), quantidade: 0 })).status, 400);
    assert.equal((await post('/contratos', base(999999))).status, 404);
    assert.equal((await post('/contratos', { ...base(clienteNovo()), frequencia: 'X' })).status, 400);
    assert.equal((await enviar('GET', '/contratos/999999')).status, 404);
    assert.equal((await put('/contratos/999999', base(1))).status, 404);
  });

  it('edita um contrato ativo', async () => {
    const c = await post('/contratos', base(clienteNovo()));
    const e = await put(`/contratos/${c.corpo.id}`, { ...base(c.corpo.clienteId), quantidade: 5, diasSemana: [2] });
    assert.equal(e.status, 200);
    assert.equal(e.corpo.quantidade, 5);
    assert.deepEqual(e.corpo.diasSemana, [2]);
    assert.equal((await put(`/contratos/${c.corpo.id}`, { ...base(c.corpo.clienteId), quantidade: 0 })).status, 400);
  });

  it('encerrar marca retirada pendente e libera um novo contrato', async () => {
    const id = clienteNovo();
    const c = await post('/contratos', base(id));
    const e = await put(`/contratos/${c.corpo.id}`, { ...base(id), situacao: 'ENCERRADO' });
    assert.equal(e.status, 200);
    assert.equal(e.corpo.situacao, 'ENCERRADO');
    const linha = ctx.db.prepare('SELECT retirada_pendente AS r FROM contratos WHERE id = ?').get(c.corpo.id) as { r: number };
    assert.equal(linha.r, 1);
    assert.equal((await put(`/contratos/${c.corpo.id}`, base(id))).status, 409);
    assert.equal((await post('/contratos', base(id))).status, 201);
  });

  it('contrato criado depois do planejamento do dia não lista hoje como próxima coleta', () => {
    const c = criarContexto({ fasePausaS: 0 });
    estadoOperacao(c); // manhã de segunda 09/11: o dia já é planejado ao entrar
    const novo = criarContrato(c, { clienteId: 50, quantidade: 1, frequencia: 'DIARIA', inicio: '2026-11-02' });
    assert.deepEqual(novo.proximas, ['2026-11-10', '2026-11-11', '2026-11-12']);
    // Contrato com parada hoje continua mostrando hoje (cliente 1: diária no seed).
    const doCliente1 = listarContratos(c.db, dataOperacao(c)).find((k) => k.clienteId === 1)!;
    assert.deepEqual(doCliente1.proximas, ['2026-11-09', '2026-11-10', '2026-11-11']);
  });

  it('lista clientes com contratoAtivo', async () => {
    const com = clienteNovo();
    const sem = clienteNovo();
    await post('/contratos', base(com));
    const lista = (await enviar('GET', '/clientes')).corpo as any[];
    assert.equal(lista.find((c) => c.id === com).contratoAtivo, true);
    assert.equal(lista.find((c) => c.id === sem).contratoAtivo, false);
  });
});

it('banco na versão 2 é recriado na versão 3', () => {
  assert.equal(VERSAO_ESQUEMA, 3);
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'esg-')), 'bombonas.db');
  const antigo = new DatabaseSync(arquivo);
  antigo.exec(`CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT); PRAGMA user_version = 2;`);
  antigo.close();
  const db = abrirBanco(arquivo);
  assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, 3);
  for (const t of ['contratos', 'operacao', 'roteiros', 'paradas'])
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t), t);
  const cols = (tab: string) => (db.prepare(`PRAGMA table_info(${tab})`).all() as any[]).map((c) => c.name);
  assert.ok(cols('bombonas').includes('roteiro_id'));
  assert.ok(cols('movimentacoes').includes('incidente'));
  db.close();
});
