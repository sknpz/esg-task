import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { litrosEsperados } from '../src/rendimento.ts';
import { criarContexto, subirApi } from './apoio.ts';

const ctx = criarContexto();
let api: Awaited<ReturnType<typeof subirApi>>;
before(async () => (api = await subirApi(ctx)));
after(() => api.fechar());

const post = async (caminho: string, corpo: unknown = {}) => {
  const r = await fetch(`${api.url}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json() };
};
const get = async (caminho: string) => (await fetch(`${api.url}${caminho}`)).json();

const bombonaDoCliente = (codigo: string) =>
  ctx.db.prepare('SELECT id, cliente_id AS clienteId FROM bombonas WHERE codigo = ?').get(codigo) as { id: number; clienteId: number };

let contador = 0;
const inserir = (clienteId: number, tipo: string, litros: number | null) => {
  const { id } = bombonaDoCliente('BO-0001');
  const quando = new Date(Date.now() - (1000 - contador++) * 1000).toISOString();
  ctx.db
    .prepare('INSERT INTO movimentacoes (bombona_id, tipo, cliente_id, litros, criado_em) VALUES (?, ?, ?, ?, ?)')
    .run(id, tipo, clienteId, litros, quando);
};
const historico = (clienteId: number, litros: number[]) => litros.forEach((l) => inserir(clienteId, 'COLETA', l));
const recuperacao = (clienteId: number, _l: number) => inserir(clienteId, 'RECUPERACAO', null);

const risco = async (clienteId: number) => (await get('/clientes')).find((c: any) => c.id === clienteId).risco;
const incidentes = async (clienteId: number) => (await get('/clientes')).find((c: any) => c.id === clienteId).incidentes;
const alertaAberto = (codigo: string, tipo: string) =>
  ctx.db
    .prepare("SELECT a.* FROM alertas a JOIN bombonas b ON b.id = a.bombona_id WHERE b.codigo = ? AND a.tipo = ? AND a.status = 'ABERTO'")
    .get(codigo, tipo) as any;

describe('coleta abaixo do esperado (RN18)', () => {
  it('calcula a média das últimas N coletas normais e ignora recuperações', () => {
    historico(1, [40, 50, 60]);
    inserir(1, 'RECUPERACAO', null);
    assert.equal(litrosEsperados(ctx.db, 1, 3), 50);
    assert.equal(litrosEsperados(ctx.db, 99, 3), null);
  });

  it('abre COLETA_ABAIXO (AVISO) abaixo de 50% e não conta no risco', async () => {
    historico(6, [50, 50, 50]); // BO-0009 está no cliente 6
    const riscoAntes = [await risco(6), await incidentes(6)];
    const { status } = await post('/bombonas/BO-0009/coleta', { litros: 20 });
    assert.equal(status, 200);
    const a = alertaAberto('BO-0009', 'COLETA_ABAIXO');
    assert.equal(a.severidade, 'AVISO');
    assert.match(a.mensagem, /20 L.*50 L/);
    assert.deepEqual([await risco(6), await incidentes(6)], riscoAntes);
  });

  it('não dispara com 50% ou mais, com menos de N coletas ou com esperado 0', async () => {
    historico(7, [40, 40, 40]); // BO-0010: 20 de 40 = 50%
    await post('/bombonas/BO-0010/coleta', { litros: 20 });
    assert.equal(alertaAberto('BO-0010', 'COLETA_ABAIXO'), undefined);

    historico(8, [50, 50]); // BO-0011: só 2 coletas
    await post('/bombonas/BO-0011/coleta', { litros: 1 });
    assert.equal(alertaAberto('BO-0011', 'COLETA_ABAIXO'), undefined);

    historico(9, [0, 0, 0]); // BO-0012: esperado 0
    await post('/bombonas/BO-0012/coleta', { litros: 0 });
    assert.equal(alertaAberto('BO-0012', 'COLETA_ABAIXO'), undefined);
  });

  it('coleta de 0 L dispara o aviso', async () => {
    historico(10, [30, 30, 30]); // BO-0013
    const { status } = await post('/bombonas/BO-0013/coleta', { litros: 0 });
    assert.equal(status, 200);
    assert.equal(alertaAberto('BO-0013', 'COLETA_ABAIXO').severidade, 'AVISO');
  });

  it('segunda coleta baixa resolve o aviso aberto (SISTEMA) e abre outro (RN12)', async () => {
    historico(11, [50, 50, 50]); // BO-0014
    await post('/bombonas/BO-0014/coleta', { litros: 10 });
    const primeiro = alertaAberto('BO-0014', 'COLETA_ABAIXO');
    const { id, clienteId } = bombonaDoCliente('BO-0014');
    ctx.db.prepare("UPDATE bombonas SET status = 'EM_CLIENTE', cliente_id = ? WHERE id = ?").run(clienteId ?? 11, id);
    await post('/bombonas/BO-0014/coleta', { litros: 5 });
    const segundo = alertaAberto('BO-0014', 'COLETA_ABAIXO');
    assert.notEqual(segundo.id, primeiro.id);
    const antigo = ctx.db.prepare('SELECT * FROM alertas WHERE id = ?').get(primeiro.id) as any;
    assert.equal(antigo.status, 'RESOLVIDO');
    assert.equal(antigo.resolvido_por, 'SISTEMA');
    assert.equal(antigo.resolucao, 'Substituído por uma coleta mais recente');
  });

  it('aceita coleta igual à capacidade e coleta de 0 L (limites da validação)', async () => {
    assert.equal((await post('/bombonas/BO-0015/coleta', { litros: 50 })).status, 200); // 50 L
    assert.equal((await post('/bombonas/BO-0016/coleta', { litros: 0 })).status, 200);
    const cap = (ctx.db.prepare("SELECT capacidade_l c FROM bombonas WHERE codigo = 'BO-0015'").get() as any).c;
    assert.equal(cap, 50);
    assert.equal((await get('/bombonas/BO-0015')).movimentacoes[0].litros, 50);
    assert.equal((await get('/bombonas/BO-0016')).movimentacoes[0].litros, 0);
  });
});
