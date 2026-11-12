import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { proximoDiaOperacao } from '../src/calendario.ts';
import { planejarDia, roteirosDoDia } from '../src/operacao.ts';
import { criarContexto } from './apoio.ts';

describe('seed: clientes, contratos e estoque do pátio', () => {
  const ctx = criarContexto({ fasePausaS: 0 });
  const um = <T>(sql: string, ...args: any[]) => ctx.db.prepare(sql).get(...args) as T;
  const todos = <T>(sql: string) => ctx.db.prepare(sql).all() as T[];

  it('50 clientes, 49 contratos ativos e 1 cliente sem contrato nem bombona', () => {
    assert.equal(um<{ n: number }>('SELECT COUNT(*) AS n FROM clientes').n, 50);
    assert.equal(um<{ n: number }>("SELECT COUNT(*) AS n FROM contratos WHERE situacao = 'ATIVO'").n, 49);
    assert.equal(um<{ n: number }>("SELECT COUNT(*) AS n FROM contratos WHERE inicio <> '2026-11-02'").n, 0);
    const sem = todos<{ id: number }>('SELECT id FROM clientes WHERE id NOT IN (SELECT cliente_id FROM contratos)');
    assert.deepEqual(sem.map((c) => c.id), [50]);
    assert.equal(um<{ n: number }>('SELECT COUNT(*) AS n FROM bombonas WHERE cliente_id = 50').n, 0);
  });

  it('quantidade do contrato = bombonas do cliente', () => {
    const linhas = todos<{ cliente_id: number; quantidade: number; n: number }>(
      `SELECT k.cliente_id, k.quantidade, (SELECT COUNT(*) FROM bombonas b WHERE b.cliente_id = k.cliente_id) AS n FROM contratos k`,
    );
    for (const l of linhas) assert.equal(l.quantidade, l.n, `cliente ${l.cliente_id}`);
  });

  it('pátio tem estoque para a frota inteira (RN24)', () => {
    const { n } = um<{ n: number }>("SELECT COUNT(*) AS n FROM bombonas WHERE status = 'PATIO'");
    assert.ok(n >= ctx.config.furgaoCapacidade * ctx.config.frotaMaxima, `${n} no pátio`);
  });

  it('pátio tem vazias de 200 L para o cliente de 200 L', () => {
    const { n } = um<{ n: number }>("SELECT COUNT(*) AS n FROM bombonas WHERE status = 'PATIO' AND capacidade_l = 200");
    assert.ok(n >= 6, `${n} de 200 L no pátio`);
  });

  it('mistura de frequências: há DIARIA, SEMANAL com mais de um dia, QUINZENAL, MENSAL e clientes com 2 ou 3 bombonas', () => {
    const freq = new Set(todos<{ frequencia: string }>('SELECT frequencia FROM contratos').map((c) => c.frequencia));
    for (const f of ['DIARIA', 'SEMANAL', 'QUINZENAL', 'MENSAL']) assert.ok(freq.has(f), f);
    assert.ok(um<{ n: number }>("SELECT COUNT(*) AS n FROM contratos WHERE frequencia = 'SEMANAL' AND dias_semana LIKE '%,%'").n > 0);
    assert.ok(um<{ n: number }>('SELECT COUNT(*) AS n FROM contratos WHERE quantidade >= 2').n > 0);
    assert.ok(um<{ n: number }>('SELECT COUNT(*) AS n FROM contratos WHERE quantidade = 3').n > 0);
  });

  it('os 12 primeiros dias de operação têm de 12 a 25 paradas e cabem na frota', () => {
    let data = '2026-11-09';
    for (let i = 0; i < 12; i++, data = proximoDiaOperacao(data)) {
      const c = criarContexto({ fasePausaS: 0 });
      planejarDia(c, data);
      const { roteiros, naoAtendidas } = roteirosDoDia(c.db, c.config, data);
      const paradas = roteiros.flatMap((r) => r.paradas).length;
      assert.ok(paradas >= 12 && paradas <= 25, `${data}: ${paradas}`);
      assert.equal(naoAtendidas.length, 0, `${data}: não atendidas`);
    }
  });

  it('o primeiro dia (09/11) tem mensal do dia 9 e sai com pelo menos 2 furgões', () => {
    assert.ok(um<{ n: number }>("SELECT COUNT(*) AS n FROM contratos WHERE frequencia = 'MENSAL' AND dia_mes = 9").n > 0);
    const c = criarContexto({ fasePausaS: 0 });
    planejarDia(c, '2026-11-09');
    assert.ok(roteirosDoDia(c.db, c.config, '2026-11-09').roteiros.length >= 2);
  });
});
