import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { criarContrato } from '../src/contratos.ts';
import { criarContexto, subirApi } from './apoio.ts';

// Venda com rastreador arrancado: o painel pede sem escolher a bombona e o servidor prefere uma de cliente com
// coleta no próximo dia de operação, para a demonstração não esperar dias pela parada que não a acha (RN22).

const ctx = criarContexto();
let api: Awaited<ReturnType<typeof subirApi>>;
before(async () => (api = await subirApi(ctx)));
after(() => api.fechar());

const post = async (corpo: unknown) => {
  const r = await fetch(`${api.url}/simulacao/comandos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json() };
};

type Linha = { codigo: string; clienteId: number | null; status: string };
const bombona = (codigo: string) =>
  ctx.db.prepare('SELECT codigo, cliente_id AS clienteId, status FROM bombonas WHERE codigo = ?').get(codigo) as Linha;
const emClienteDe = (clienteId: number) =>
  (
    ctx.db
      .prepare("SELECT codigo FROM bombonas WHERE cliente_id = ? AND status = 'EM_CLIENTE' AND roteiro_id IS NULL ORDER BY codigo")
      .all(clienteId) as Array<{ codigo: string }>
  ).map((b) => b.codigo);

// Data de operação: segunda 09/11/2026 (a inicial). Próximo dia de operação: terça 10/11.
const semanal = (clienteId: number, dia: number) =>
  criarContrato(ctx, { clienteId, quantidade: 1, frequencia: 'SEMANAL', diasSemana: [dia], inicio: '2026-11-02' });

describe('cenário VENDA_SILENCIOSA (venda com rastreador arrancado)', () => {
  beforeEach(() => {
    ctx.db.exec('DELETE FROM simulacao_comandos');
    ctx.db.exec('DELETE FROM contratos');
  });

  it('VENDA_SILENCIOSA sem bombona escolhe cliente com coleta no próximo dia', async () => {
    const [terca, quarta] = (ctx.db
      .prepare(
        `SELECT cliente_id AS id FROM bombonas WHERE status = 'EM_CLIENTE' AND roteiro_id IS NULL
         GROUP BY cliente_id ORDER BY cliente_id LIMIT 2`,
      )
      .all() as Array<{ id: number }>).map((c) => c.id);
    semanal(terca, 2);
    semanal(quarta, 3);
    const doCliente = emClienteDe(terca);
    assert.ok(doCliente.length >= 1);

    // Uma de cada vez, só as do cliente da terça; a mesma bombona não é escolhida duas vezes.
    const escolhidas: string[] = [];
    for (const _ of doCliente) {
      const r = await post({ tipo: 'VENDA_SILENCIOSA' });
      assert.equal(r.status, 201);
      assert.equal(r.corpo.tipo, 'VENDA_SILENCIOSA');
      escolhidas.push(r.corpo.bombona);
    }
    assert.deepEqual(escolhidas.toSorted(), doCliente);

    // Sem candidata no próximo dia, qualquer bombona em cliente que ainda não foi "vendida".
    const r = await post({ tipo: 'VENDA_SILENCIOSA' });
    assert.equal(r.status, 201);
    const outra = bombona(r.corpo.bombona);
    assert.equal(outra.status, 'EM_CLIENTE');
    assert.notEqual(outra.clienteId, terca);

    const comandos = ctx.db.prepare("SELECT COUNT(*) AS n FROM simulacao_comandos WHERE tipo = 'VENDA_SILENCIOSA'").get() as { n: number };
    assert.equal(comandos.n, doCliente.length + 1);
  });

  it('VENDA_SILENCIOSA com bombona usa a bombona pedida', async () => {
    const r = await post({ tipo: 'VENDA_SILENCIOSA', bombona: 'BO-0010' });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.bombona, 'BO-0010');
  });

  it('os outros cenários continuam exigindo a bombona', async () => {
    assert.equal((await post({ tipo: 'VENDA' })).status, 404);
  });

  it('VENDA_SILENCIOSA sem bombona em cliente → 409', async () => {
    ctx.db.exec("UPDATE bombonas SET status = 'PATIO', cliente_id = NULL WHERE status = 'EM_CLIENTE'");
    const r = await post({ tipo: 'VENDA_SILENCIOSA' });
    assert.equal(r.status, 409);
    assert.ok(r.corpo.erro);
  });
});
