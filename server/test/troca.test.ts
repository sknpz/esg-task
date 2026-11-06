import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { abrirAlerta } from '../src/alertas.ts';
import type { Config } from '../src/config.ts';
import type { Contexto } from '../src/contexto.ts';
import { criarContrato, editarContrato } from '../src/contratos.ts';
import { listarClientes } from '../src/consultas.ts';
import { agoraIso } from '../src/db.ts';
import type { Evento } from '../src/eventos.ts';
import {
  avancarOperacao,
  concluirRoteiro,
  estadoOperacao,
  iniciarRoteiros,
  planejarDia,
  registrarTroca,
  retomarAposReinicio,
  roteirosDoDia,
} from '../src/operacao.ts';
import { coletar, ErroDeNegocio, resolverAlerta } from '../src/operacoes.ts';
import { processarLeitura } from '../src/regras.ts';
import { litrosEsperados } from '../src/rendimento.ts';
import { criarContexto, subirApi } from './apoio.ts';

type Contrato = { cliente: number; qtd: number };

const SEGUNDA = '2026-11-09';
const TERCA = '2026-11-10';

/** Contexto sem os contratos do seed, com contratos diários (início em 02/11/2026). */
function cenario(contratos: Contrato[] = [], ajustes: Partial<Config> = {}) {
  const ctx = criarContexto({ fasePausaS: 0, ...ajustes });
  ctx.db.exec('DELETE FROM contratos');
  const ids = contratos.map(
    (c) => criarContrato(ctx, { clienteId: c.cliente, quantidade: c.qtd, frequencia: 'DIARIA', inicio: '2026-11-02' }).id,
  );
  return { ctx, ids };
}

/** Planeja e faz os furgões de segunda saírem. */
function sair(ctx: Contexto) {
  planejarDia(ctx, SEGUNDA);
  iniciarRoteiros(ctx, SEGUNDA);
  const [roteiro] = roteirosDoDia(ctx.db, ctx.config, SEGUNDA).roteiros;
  const parada = (clienteId: number) => roteiro.paradas.find((p) => p.cliente.id === clienteId)!;
  return { roteiro, parada };
}

type Linha = { id: number; codigo: string; status: string; clienteId: number | null; roteiroId: number | null; capacidade: number };
const bombona = (ctx: Contexto, codigo: string) =>
  ctx.db
    .prepare('SELECT id, codigo, status, cliente_id AS clienteId, roteiro_id AS roteiroId, capacidade_l AS capacidade FROM bombonas WHERE codigo = ?')
    .get(codigo) as Linha;
const statusDe = (ctx: Contexto, codigos: string[]) => codigos.map((c) => bombona(ctx, c).status);
const doRoteiro = (ctx: Contexto, roteiroId: number) =>
  (ctx.db.prepare('SELECT codigo FROM bombonas WHERE roteiro_id = ? ORDER BY codigo').all(roteiroId) as Array<{ codigo: string }>).map(
    (b) => b.codigo,
  );
const ultimaMovimentacao = (ctx: Contexto, codigo: string) =>
  ctx.db
    .prepare(
      `SELECT m.tipo, m.cliente_id AS clienteId, m.litros, m.incidente, m.observacao, m.criado_em AS criadoEm
       FROM movimentacoes m JOIN bombonas b ON b.id = m.bombona_id WHERE b.codigo = ? ORDER BY m.id DESC LIMIT 1`,
    )
    .get(codigo) as { tipo: string; clienteId: number | null; litros: number | null; incidente: number; observacao: string | null; criadoEm: string };
const alertasAbertos = (ctx: Contexto, codigo: string, tipo: string) =>
  ctx.db
    .prepare(
      "SELECT a.* FROM alertas a JOIN bombonas b ON b.id = a.bombona_id WHERE b.codigo = ? AND a.tipo = ? AND a.status = 'ABERTO'",
    )
    .all(codigo, tipo) as Array<{ severidade: string; mensagem: string; cliente_id: number }>;
const risco = (ctx: Contexto, clienteId: number) =>
  listarClientes(ctx.db).find((c) => (c as unknown as { id: number }).id === clienteId) as unknown as {
    incidentes: number;
    ultimoIncidente: string | null;
  };
const contar = (ctx: Contexto, tabela: string) => (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;

/** FORA_DA_AREA aberto agora para a bombona (como o rastreador faria). */
const foraDaArea = (ctx: Contexto, codigo: string, em = agoraIso()) =>
  abrirAlerta(ctx.db, {
    bombonaId: bombona(ctx, codigo).id,
    clienteId: bombona(ctx, codigo).clienteId,
    tipo: 'FORA_DA_AREA',
    severidade: 'AVISO',
    mensagem: 'Saiu da cerca',
    em,
  });

// Seed: cliente 1 tem BO-0001 e BO-0002 (50 L); cliente 5 tem BO-0006 a BO-0008 (200 L); cliente 6 tem BO-0009.
// Pátio: BO-0018 a BO-0022, carregadas nessa ordem.

describe('troca na parada (RN21)', () => {
  it('troca normal: leva as cheias com litros, deixa as vazias', () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const { roteiro, parada } = sair(ctx);
    const eventos: Evento[] = [];
    ctx.eventos.ouvir((e) => eventos.push(e));

    const feita = registrarTroca(ctx, roteiro.id, parada(1).id, {
      encontradas: [
        { codigo: 'BO-0001', litros: 30 },
        { codigo: 'BO-0002', litros: 40 },
      ],
    });

    assert.deepEqual(statusDe(ctx, ['BO-0001', 'BO-0002']), ['EM_ROTA', 'EM_ROTA']);
    for (const c of ['BO-0001', 'BO-0002']) {
      assert.equal(bombona(ctx, c).clienteId, null);
      assert.equal(bombona(ctx, c).roteiroId, roteiro.id);
    }
    assert.deepEqual(statusDe(ctx, ['BO-0018', 'BO-0019']), ['EM_CLIENTE', 'EM_CLIENTE']);
    for (const c of ['BO-0018', 'BO-0019']) {
      assert.equal(bombona(ctx, c).clienteId, 1);
      assert.equal(bombona(ctx, c).roteiroId, null);
      const m = ultimaMovimentacao(ctx, c);
      assert.deepEqual([m.tipo, m.clienteId, m.observacao], ['ENTREGA_CONCLUIDA', 1, 'Deixada na troca']);
    }
    const coleta = ultimaMovimentacao(ctx, 'BO-0001');
    assert.deepEqual([coleta.tipo, coleta.clienteId, coleta.litros], ['COLETA', 1, 30]);
    assert.equal(ultimaMovimentacao(ctx, 'BO-0002').litros, 40);

    assert.equal(feita.status, 'FEITA');
    assert.deepEqual(feita.resultado, {
      deixadas: ['BO-0018', 'BO-0019'],
      levadas: [
        { codigo: 'BO-0001', litros: 30 },
        { codigo: 'BO-0002', litros: 40 },
      ],
      naoEncontradas: [],
    });
    const feitaEm = ctx.db.prepare('SELECT feita_em FROM paradas WHERE id = ?').get(feita.id) as { feita_em: string | null };
    assert.ok(feitaEm.feita_em);

    const tocadas = eventos.filter((e) => e.tipo === 'bombona').map((e) => (e.dados as { codigo: string }).codigo).sort();
    assert.deepEqual(tocadas, ['BO-0001', 'BO-0002', 'BO-0018', 'BO-0019']);
    assert.ok(eventos.some((e) => e.tipo === 'roteiro' && (e.dados as { id: number }).id === roteiro.id));
  });

  it('coleta pela troca dispara a RN18 com histórico baixo', () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const { id } = bombona(ctx, 'BO-0001');
    const ins = ctx.db.prepare("INSERT INTO movimentacoes (bombona_id, tipo, cliente_id, litros, criado_em) VALUES (?, 'COLETA', 1, 50, ?)");
    for (let i = 3; i >= 1; i--) ins.run(id, new Date(Date.now() - i * 60_000).toISOString());
    const { roteiro, parada } = sair(ctx);

    registrarTroca(ctx, roteiro.id, parada(1).id, {
      encontradas: [
        { codigo: 'BO-0001', litros: 10 },
        { codigo: 'BO-0002', litros: 45 },
      ],
    });
    const [aviso] = alertasAbertos(ctx, 'BO-0001', 'COLETA_ABAIXO');
    assert.equal(aviso.severidade, 'AVISO');
    assert.match(aviso.mensagem, /10 L.*50 L/);
    assert.equal(aviso.cliente_id, 1);
  });

  it('na mesma troca, o esperado da 2ª bombona já inclui os litros da 1ª (RN18)', () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const { id } = bombona(ctx, 'BO-0001');
    const ins = ctx.db.prepare("INSERT INTO movimentacoes (bombona_id, tipo, cliente_id, litros, criado_em) VALUES (?, 'COLETA', 1, 20, ?)");
    for (let i = 3; i >= 1; i--) ins.run(id, new Date(Date.now() - i * 60_000).toISOString());
    const { roteiro, parada } = sair(ctx);

    // 1ª: 50 L, esperado 20 → sem aviso. 2ª: 14 L; esperado (50 + 20 + 20) / 3 = 30 → 14 < 15 → aviso.
    // (Se a 1ª não entrasse na média, o esperado seria 20 e 14 L não avisaria.)
    registrarTroca(ctx, roteiro.id, parada(1).id, {
      encontradas: [
        { codigo: 'BO-0001', litros: 50 },
        { codigo: 'BO-0002', litros: 14 },
      ],
    });
    assert.deepEqual(alertasAbertos(ctx, 'BO-0001', 'COLETA_ABAIXO'), []);
    const [aviso] = alertasAbertos(ctx, 'BO-0002', 'COLETA_ABAIXO');
    assert.match(aviso.mensagem, /14 L.*~30 L/);
  });

  it('cliente novo: só deixa vazias', () => {
    const { ctx } = cenario();
    const clienteId = Number(
      ctx.db
        .prepare("INSERT INTO clientes (nome, tipo, cidade, endereco, lat, lng) VALUES ('Cliente novo', 'x', 'Cianorte', 'rua', -23.66, -52.6)")
        .run().lastInsertRowid,
    );
    criarContrato(ctx, { clienteId, quantidade: 2, frequencia: 'DIARIA', inicio: '2026-11-02' });
    const { roteiro, parada } = sair(ctx);
    const feita = registrarTroca(ctx, roteiro.id, parada(clienteId).id, { encontradas: [] });
    assert.deepEqual(feita.resultado, { deixadas: ['BO-0018', 'BO-0019'], levadas: [], naoEncontradas: [] });
    assert.deepEqual(statusDe(ctx, ['BO-0018', 'BO-0019']), ['EM_CLIENTE', 'EM_CLIENTE']);
    assert.deepEqual(doRoteiro(ctx, roteiro.id), []);
  });

  it('retirada: leva tudo e não deixa nada', () => {
    const { ctx, ids } = cenario([{ cliente: 1, qtd: 2 }]);
    editarContrato(ctx, ids[0], { quantidade: 2, frequencia: 'DIARIA', inicio: '2026-11-02', situacao: 'ENCERRADO' });
    const { roteiro, parada } = sair(ctx);
    assert.equal(parada(1).motivo, 'RETIRADA');
    assert.deepEqual(doRoteiro(ctx, roteiro.id), []);
    const feita = registrarTroca(ctx, roteiro.id, parada(1).id, {
      encontradas: [
        { codigo: 'BO-0001', litros: 20 },
        { codigo: 'BO-0002', litros: 25 },
      ],
    });
    assert.deepEqual(feita.resultado?.deixadas, []);
    assert.deepEqual(statusDe(ctx, ['BO-0001', 'BO-0002']), ['EM_ROTA', 'EM_ROTA']);
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM bombonas WHERE cliente_id = 1').get() as { n: number }).n, 0);
  });

  it('litros inválidos na troca → 400 e nada muda', () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const { roteiro, parada } = sair(ctx);
    const antes = [contar(ctx, 'movimentacoes'), contar(ctx, 'alertas')];
    for (const litros of [51, -1, 2.5, '30', null]) {
      assert.throws(
        () =>
          registrarTroca(ctx, roteiro.id, parada(1).id, {
            encontradas: [
              { codigo: 'BO-0001', litros: 30 },
              { codigo: 'BO-0002', litros: litros as number },
            ],
          }),
        (e: unknown) => e instanceof ErroDeNegocio && e.status === 400,
      );
    }
    assert.throws(
      () => registrarTroca(ctx, roteiro.id, parada(1).id, { encontradas: 'tudo' as never }),
      (e: unknown) => e instanceof ErroDeNegocio && e.status === 400,
    );
    assert.deepEqual([contar(ctx, 'movimentacoes'), contar(ctx, 'alertas')], antes);
    assert.deepEqual(statusDe(ctx, ['BO-0001', 'BO-0002', 'BO-0018', 'BO-0019']), ['EM_CLIENTE', 'EM_CLIENTE', 'EM_ROTA', 'EM_ROTA']);
    assert.equal(roteirosDoDia(ctx.db, ctx.config, SEGUNDA).roteiros[0].paradas[0].status, 'PENDENTE');
  });
});

describe('sumiço descoberto na parada (RN22)', () => {
  it('venda vista pelo rastreador e depois não encontrada: risco sobe só 1', () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const { roteiro, parada } = sair(ctx);
    const antes = risco(ctx, 1);
    foraDaArea(ctx, 'BO-0002'); // depois da ENTREGA_CONCLUIDA do seed
    const feita = registrarTroca(ctx, roteiro.id, parada(1).id, { encontradas: [{ codigo: 'BO-0001', litros: 30 }] });

    assert.equal(risco(ctx, 1).incidentes, antes.incidentes + 1);
    assert.deepEqual(feita.resultado?.naoEncontradas, [{ codigo: 'BO-0002', incidente: false }]);
    assert.deepEqual(feita.resultado?.deixadas, ['BO-0018', 'BO-0019']); // deixa as vazias do mesmo jeito
    const m = ultimaMovimentacao(ctx, 'BO-0002');
    assert.deepEqual([m.tipo, m.clienteId, m.incidente], ['NAO_ENCONTRADA', 1, 0]);
    const b = bombona(ctx, 'BO-0002');
    assert.deepEqual([b.status, b.clienteId, b.roteiroId], ['EXTRAVIADA', 1, null]);
    assert.equal(alertasAbertos(ctx, 'BO-0002', 'EXTRAVIO').length, 1);
  });

  it('já EXTRAVIADA na parada (rastreador viu): não conta de novo e o EXTRAVIO não duplica', () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const { roteiro, parada } = sair(ctx);
    foraDaArea(ctx, 'BO-0002');
    abrirAlerta(ctx.db, { bombonaId: bombona(ctx, 'BO-0002').id, clienteId: 1, tipo: 'EXTRAVIO', severidade: 'CRITICO', mensagem: 'longe', em: agoraIso() });
    ctx.db.prepare("UPDATE bombonas SET status = 'EXTRAVIADA' WHERE codigo = 'BO-0002'").run();
    const antes = risco(ctx, 1);
    // Mesmo que venha em "encontradas", extraviada não é levada pela troca.
    const feita = registrarTroca(ctx, roteiro.id, parada(1).id, {
      encontradas: [
        { codigo: 'BO-0001', litros: 30 },
        { codigo: 'BO-0002', litros: 30 },
      ],
    });
    assert.deepEqual(feita.resultado?.naoEncontradas, [{ codigo: 'BO-0002', incidente: false }]);
    assert.equal(risco(ctx, 1).incidentes, antes.incidentes);
    assert.equal(bombona(ctx, 'BO-0002').status, 'EXTRAVIADA');
    const extravios = alertasAbertos(ctx, 'BO-0002', 'EXTRAVIO');
    assert.equal(extravios.length, 1);
    assert.equal(extravios[0].mensagem, 'longe');
  });

  it('rastreador mudo (sem FORA_DA_AREA desde a entrega): não encontrada conta incidente e abre EXTRAVIO', () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const { roteiro, parada } = sair(ctx);
    const antes = risco(ctx, 1);
    const feita = registrarTroca(ctx, roteiro.id, parada(1).id, { encontradas: [{ codigo: 'BO-0001', litros: 30 }] });

    assert.deepEqual(feita.resultado?.naoEncontradas, [{ codigo: 'BO-0002', incidente: true }]);
    const depois = risco(ctx, 1);
    assert.equal(depois.incidentes, antes.incidentes + 1);
    const m = ultimaMovimentacao(ctx, 'BO-0002');
    assert.deepEqual([m.tipo, m.incidente], ['NAO_ENCONTRADA', 1]);
    assert.equal(depois.ultimoIncidente, m.criadoEm);
    const [extravio] = alertasAbertos(ctx, 'BO-0002', 'EXTRAVIO');
    assert.equal(extravio.severidade, 'CRITICO');
    assert.equal(extravio.mensagem, 'Não encontrada na coleta de Restaurante Sabor da Terra');
    assert.equal(bombona(ctx, 'BO-0002').status, 'EXTRAVIADA');
  });

  it('sumiço já registrado não é procurado de novo na visita seguinte', () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const { roteiro, parada } = sair(ctx);
    registrarTroca(ctx, roteiro.id, parada(1).id, { encontradas: [{ codigo: 'BO-0001', litros: 30 }] });
    concluirRoteiro(ctx, roteiro.id);
    const depoisDaPrimeira = risco(ctx, 1).incidentes;
    const naoEncontradas = () =>
      (
        ctx.db
          .prepare("SELECT COUNT(*) AS n FROM movimentacoes WHERE tipo = 'NAO_ENCONTRADA' AND bombona_id = ?")
          .get(bombona(ctx, 'BO-0002').id) as { n: number }
      ).n;
    assert.equal(naoEncontradas(), 1);
    // O operador encerra o EXTRAVIO (ex.: valor cobrado do cliente); a próxima parada não o reabre.
    const [extravio] = ctx.db
      .prepare("SELECT a.id FROM alertas a WHERE a.tipo = 'EXTRAVIO' AND a.status = 'ABERTO' AND a.bombona_id = ?")
      .all(bombona(ctx, 'BO-0002').id) as Array<{ id: number }>;
    resolverAlerta(ctx, extravio.id, 'Não recuperada; reposição cobrada do cliente');

    planejarDia(ctx, TERCA);
    iniciarRoteiros(ctx, TERCA);
    const [r2] = roteirosDoDia(ctx.db, ctx.config, TERCA).roteiros;
    assert.equal(r2.paradas[0].demanda, 2); // BO-0018 e BO-0019, deixadas na segunda
    const feita = registrarTroca(ctx, r2.id, r2.paradas[0].id, {
      encontradas: [
        { codigo: 'BO-0018', litros: 30 },
        { codigo: 'BO-0019', litros: 30 },
      ],
    });
    assert.deepEqual(feita.resultado?.naoEncontradas, []);
    assert.equal(naoEncontradas(), 1);
    assert.deepEqual(alertasAbertos(ctx, 'BO-0002', 'EXTRAVIO'), []);
    assert.equal(bombona(ctx, 'BO-0002').status, 'EXTRAVIADA');
    assert.equal(risco(ctx, 1).incidentes, depoisDaPrimeira);
  });

  it('sumiço já registrado sai da conta do cliente no planejamento (retirada sem bombona a buscar)', () => {
    // Cliente 6 só tem a BO-0009. A retirada não a encontra; uma segunda retirada não tem o que buscar.
    const { ctx, ids } = cenario([{ cliente: 6, qtd: 1 }]);
    editarContrato(ctx, ids[0], { quantidade: 1, frequencia: 'DIARIA', inicio: '2026-11-02', situacao: 'ENCERRADO' });
    const { roteiro, parada } = sair(ctx);
    assert.equal(parada(6).motivo, 'RETIRADA');
    const feita = registrarTroca(ctx, roteiro.id, parada(6).id, { encontradas: [] });
    assert.deepEqual(feita.resultado?.naoEncontradas, [{ codigo: 'BO-0009', incidente: true }]);
    concluirRoteiro(ctx, roteiro.id);

    const { id } = criarContrato(ctx, { clienteId: 6, quantidade: 1, frequencia: 'SEMANAL', diasSemana: [6], inicio: '2026-11-02' });
    editarContrato(ctx, id, { quantidade: 1, frequencia: 'SEMANAL', diasSemana: [6], inicio: '2026-11-02', situacao: 'ENCERRADO' });
    planejarDia(ctx, TERCA);
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM paradas WHERE data = ?').get(TERCA) as { n: number }).n, 0);
  });

  it('FORA_DA_AREA antigo, de antes da última entrega, não impede a contagem', () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const { roteiro, parada } = sair(ctx);
    const dezDias = new Date(Date.now() - 10 * 86_400_000).toISOString(); // a entrega do seed foi há 4 dias
    foraDaArea(ctx, 'BO-0002', dezDias);
    ctx.db.prepare("UPDATE alertas SET status = 'RESOLVIDO' WHERE tipo = 'FORA_DA_AREA' AND aberto_em = ?").run(dezDias);
    const antes = risco(ctx, 1);
    const feita = registrarTroca(ctx, roteiro.id, parada(1).id, { encontradas: [{ codigo: 'BO-0001', litros: 30 }] });
    assert.deepEqual(feita.resultado?.naoEncontradas, [{ codigo: 'BO-0002', incidente: true }]);
    assert.equal(risco(ctx, 1).incidentes, antes.incidentes + 1);
  });

  it('sem entrega registrada, qualquer FORA_DA_AREA da bombona conta como já visto', () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const { roteiro, parada } = sair(ctx);
    ctx.db.prepare("DELETE FROM movimentacoes WHERE tipo = 'ENTREGA_CONCLUIDA' AND bombona_id = ?").run(bombona(ctx, 'BO-0002').id);
    foraDaArea(ctx, 'BO-0002', new Date(Date.now() - 100 * 86_400_000).toISOString());
    const feita = registrarTroca(ctx, roteiro.id, parada(1).id, { encontradas: [{ codigo: 'BO-0001', litros: 30 }] });
    assert.deepEqual(feita.resultado?.naoEncontradas, [{ codigo: 'BO-0002', incidente: false }]);
  });

  it('sumiço visto primeiro na parada e depois pelo rastreador: FORA_DA_AREA reaberto, risco sobe só 1', () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const { roteiro, parada } = sair(ctx);
    const antes = risco(ctx, 1);
    // Rastreador mudo na hora da parada: o sumiço é registrado por ela.
    const feita = registrarTroca(ctx, roteiro.id, parada(1).id, { encontradas: [{ codigo: 'BO-0001', litros: 30 }] });
    assert.deepEqual(feita.resultado?.naoEncontradas, [{ codigo: 'BO-0002', incidente: true }]);
    assert.equal(risco(ctx, 1).incidentes, antes.incidentes + 1);

    // O rastreador volta a mandar leitura, longe do cliente: duas leituras fora confirmam a saída (RN07).
    const { dispositivoId } = ctx.db.prepare("SELECT dispositivo_id AS dispositivoId FROM bombonas WHERE codigo = 'BO-0002'").get() as {
      dispositivoId: string;
    };
    const cliente = ctx.db.prepare('SELECT lat, lng FROM clientes WHERE id = 1').get() as { lat: number; lng: number };
    for (let i = 1; i <= 2; i++) {
      processarLeitura(ctx, dispositivoId, {
        lat: cliente.lat + 0.05, // ~5,5 km ao norte
        lng: cliente.lng,
        precisao: 10,
        bateria: 80,
        registradoEm: new Date(Date.now() + i * 1000).toISOString(),
      });
    }
    const fora = ctx.db
      .prepare("SELECT reaberto FROM alertas a JOIN bombonas b ON b.id = a.bombona_id WHERE b.codigo = 'BO-0002' AND a.tipo = 'FORA_DA_AREA' AND a.status = 'ABERTO'")
      .all() as Array<{ reaberto: number }>;
    assert.deepEqual(fora.map((a) => a.reaberto), [1]);
    assert.equal(risco(ctx, 1).incidentes, antes.incidentes + 1);
  });

  it('2 de 3 sumidas: regra roda para cada uma', () => {
    const { ctx } = cenario([{ cliente: 5, qtd: 3 }]);
    const { roteiro, parada } = sair(ctx);
    foraDaArea(ctx, 'BO-0007');
    const antes = risco(ctx, 5);
    const feita = registrarTroca(ctx, roteiro.id, parada(5).id, { encontradas: [{ codigo: 'BO-0006', litros: 150 }] });
    assert.deepEqual(feita.resultado?.naoEncontradas, [
      { codigo: 'BO-0007', incidente: false },
      { codigo: 'BO-0008', incidente: true },
    ]);
    assert.deepEqual(feita.resultado?.levadas, [{ codigo: 'BO-0006', litros: 150 }]);
    assert.equal(feita.resultado?.deixadas.length, 3);
    assert.equal(risco(ctx, 5).incidentes, antes.incidentes + 1);
    assert.deepEqual(statusDe(ctx, ['BO-0006', 'BO-0007', 'BO-0008']), ['EM_ROTA', 'EXTRAVIADA', 'EXTRAVIADA']);
    assert.equal(alertasAbertos(ctx, 'BO-0007', 'EXTRAVIO').length, 1);
    assert.equal(alertasAbertos(ctx, 'BO-0008', 'EXTRAVIO').length, 1);
  });
});

describe('fim do roteiro e reinício', () => {
  it('concluir devolve cheias e vazias que sobraram ao pátio, sem roteiro_id', () => {
    const { ctx } = cenario([
      { cliente: 1, qtd: 2 },
      { cliente: 6, qtd: 1 },
    ]);
    const { roteiro, parada } = sair(ctx);
    assert.equal(roteiro.paradas.length, 2);
    const vaziaDo6 = (ctx.db.prepare('SELECT codigo FROM bombonas WHERE roteiro_id = ? AND cliente_id = 6').get(roteiro.id) as { codigo: string })
      .codigo;
    registrarTroca(ctx, roteiro.id, parada(1).id, {
      encontradas: [
        { codigo: 'BO-0001', litros: 30 },
        { codigo: 'BO-0002', litros: 40 },
      ],
    });

    const concluido = concluirRoteiro(ctx, roteiro.id);
    assert.equal(concluido.status, 'CONCLUIDO');
    const p6 = concluido.paradas.find((p) => p.cliente.id === 6)!;
    assert.equal(p6.status, 'NAO_ATENDIDA');
    assert.equal(typeof p6.resultado?.observacao, 'string');
    assert.equal(concluido.paradas.find((p) => p.cliente.id === 1)!.status, 'FEITA');

    assert.deepEqual(doRoteiro(ctx, roteiro.id), []);
    for (const c of ['BO-0001', 'BO-0002', vaziaDo6]) {
      const b = bombona(ctx, c);
      assert.deepEqual([b.status, b.clienteId, b.roteiroId], ['PATIO', null, null]);
      assert.equal(ultimaMovimentacao(ctx, c).tipo, 'RETORNO_AO_PATIO');
    }
    assert.equal(bombona(ctx, 'BO-0009').status, 'EM_CLIENTE');
    assert.equal(roteirosDoDia(ctx.db, ctx.config, SEGUNDA).roteiros[0].status, 'CONCLUIDO');

    assert.throws(() => concluirRoteiro(ctx, roteiro.id), (e: unknown) => e instanceof ErroDeNegocio && e.status === 409);
    assert.throws(() => registrarTroca(ctx, roteiro.id, p6.id, { encontradas: [] }), (e: unknown) => e instanceof ErroDeNegocio && e.status === 409);
  });

  it('reinício conclui o roteiro em andamento e o dia avança', () => {
    const { ctx } = cenario([
      { cliente: 1, qtd: 2 },
      { cliente: 5, qtd: 3 },
    ]);
    retomarAposReinicio(ctx); // nada em andamento: não faz nada
    estadoOperacao(ctx);
    avancarOperacao(ctx);
    assert.equal(estadoOperacao(ctx).fase, 'ROTAS');
    ctx.db.prepare("UPDATE bombonas SET status = 'EXTRAVIADA' WHERE codigo = 'BO-0008'").run();
    const esperado1 = litrosEsperados(ctx.db, 1, ctx.config.coletaHistoricoN);
    assert.notEqual(esperado1, null);

    retomarAposReinicio(ctx);

    const { roteiros } = roteirosDoDia(ctx.db, ctx.config, SEGUNDA);
    assert.ok(roteiros.length >= 1);
    for (const r of roteiros) {
      assert.equal(r.status, 'CONCLUIDO');
      for (const p of r.paradas) assert.equal(p.status, 'FEITA');
    }
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM bombonas WHERE roteiro_id IS NOT NULL').get() as { n: number }).n, 0);
    assert.equal(
      (ctx.db.prepare("SELECT COUNT(*) AS n FROM bombonas WHERE status = 'EM_ROTA' AND codigo BETWEEN 'BO-0001' AND 'BO-0022'").get() as { n: number }).n,
      0,
    );
    const paradas = roteiros.flatMap((r) => r.paradas);
    const p1 = paradas.find((p) => p.cliente.id === 1)!;
    const litros = Math.min(50, Math.round(esperado1!));
    assert.deepEqual(p1.resultado?.levadas, [
      { codigo: 'BO-0001', litros },
      { codigo: 'BO-0002', litros },
    ]);
    const p5 = paradas.find((p) => p.cliente.id === 5)!;
    assert.deepEqual(p5.resultado?.levadas.map((l) => l.codigo), ['BO-0006', 'BO-0007']);
    assert.deepEqual(p5.resultado?.naoEncontradas.map((n) => n.codigo), ['BO-0008']);

    avancarOperacao(ctx);
    assert.equal(estadoOperacao(ctx).fase, 'FIM');
    avancarOperacao(ctx);
    assert.deepEqual([estadoOperacao(ctx).fase, estadoOperacao(ctx).data], ['MANHA', TERCA]);
  });
});

describe('API dos furgões (simulador)', () => {
  let encerrar: Array<() => unknown> = [];
  afterEach(async () => {
    await Promise.all(encerrar.map((f) => f()));
    encerrar = [];
  });

  async function api(ctx: Contexto) {
    const servidor = await subirApi(ctx);
    encerrar.push(servidor.fechar);
    const chamar = async (caminho: string, corpo?: unknown, token: string | null = ctx.config.tokenSimulador) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch(`${servidor.url}${caminho}`, {
        method: corpo === undefined ? 'GET' : 'POST',
        headers,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
      return { status: r.status, corpo: await r.json() };
    };
    return chamar;
  }

  it('troca em parada já feita → 409; sem token → 401', async () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const { roteiro, parada } = sair(ctx);
    const chamar = await api(ctx);
    const troca = `/roteiros/${roteiro.id}/paradas/${parada(1).id}/troca`;
    const corpo = { encontradas: [{ codigo: 'BO-0001', litros: 30 }, { codigo: 'BO-0002', litros: 40 }] };

    for (const [caminho, c] of [
      [troca, corpo],
      [`/roteiros/${roteiro.id}/trajeto`, { pontos: [[0, 0], [1, 1]], distanciaM: 10 }],
      [`/roteiros/${roteiro.id}/posicao`, { lat: 0, lng: 0 }],
      [`/roteiros/${roteiro.id}/concluir`, {}],
    ] as const) {
      assert.equal((await chamar(caminho, c, null)).status, 401);
      assert.equal((await chamar(caminho, c, 'errado')).status, 401);
    }
    assert.equal(roteirosDoDia(ctx.db, ctx.config, SEGUNDA).roteiros[0].status, 'EM_ANDAMENTO');

    assert.equal((await chamar(troca, { encontradas: [{ codigo: 'BO-0001', litros: 51 }] })).status, 400);
    const ok = await chamar(troca, corpo);
    assert.equal(ok.status, 200);
    assert.equal(ok.corpo.status, 'FEITA');
    assert.deepEqual(ok.corpo.resultado.deixadas, ['BO-0018', 'BO-0019']);
    assert.equal((await chamar(troca, corpo)).status, 409);
    assert.equal((await chamar(`/roteiros/${roteiro.id}/paradas/9999/troca`, corpo)).status, 404);
    assert.equal((await chamar('/roteiros/9999/concluir', {})).status, 404);

    const fim = await chamar(`/roteiros/${roteiro.id}/concluir`, {});
    assert.equal(fim.status, 200);
    assert.equal(fim.corpo.status, 'CONCLUIDO');
    assert.equal((await chamar(`/roteiros/${roteiro.id}/concluir`, {})).status, 409);
  });

  it('trajeto e posição do furgão', async () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const { roteiro } = sair(ctx);
    const chamar = await api(ctx);
    const eventos: Evento[] = [];
    ctx.eventos.ouvir((e) => eventos.push(e));

    const pontos = [
      [-23.7, -52.6],
      [-23.66, -52.61],
      [-23.7, -52.6],
    ];
    assert.equal((await chamar(`/roteiros/${roteiro.id}/trajeto`, { pontos: [[1]], distanciaM: 10 })).status, 400);
    assert.equal((await chamar(`/roteiros/${roteiro.id}/trajeto`, { pontos, distanciaM: -1 })).status, 400);
    const t = await chamar(`/roteiros/${roteiro.id}/trajeto`, { pontos, distanciaM: 12_345 });
    assert.equal(t.status, 200);
    assert.deepEqual(t.corpo.trajeto, pontos);
    assert.equal(t.corpo.distanciaM, 12_345);

    assert.equal((await chamar(`/roteiros/${roteiro.id}/posicao`, { lat: 'x', lng: 1 })).status, 400);
    const p = await chamar(`/roteiros/${roteiro.id}/posicao`, { lat: -23.68, lng: -52.62 });
    assert.equal(p.status, 200);
    // Resposta curta: a posição chega a cada passo do furgão.
    assert.deepEqual(p.corpo, { ok: true });
    assert.deepEqual(roteirosDoDia(ctx.db, ctx.config, SEGUNDA).roteiros[0].posicao, { lat: -23.68, lng: -52.62 });
    // A posição vai num evento leve, sem o roteiro inteiro (o trajeto pode ser grande).
    const depoisDoTrajeto = eventos.slice(eventos.findIndex((e) => e.tipo === 'roteiro') + 1);
    assert.deepEqual(depoisDoTrajeto, [{ tipo: 'furgao', dados: { roteiroId: roteiro.id, lat: -23.68, lng: -52.62 } }]);
    assert.equal((await chamar('/roteiros/9999/posicao', { lat: 1, lng: 1 })).status, 404);
  });

  it('/simulacao/estado diz se o rastreador foi arrancado (sobrevive ao reinício do simulador)', async () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const chamar = await api(ctx);
    const arrancada = async (codigo: string) =>
      ((await chamar('/simulacao/estado')).corpo.dispositivos as Array<{ bombona: string; arrancada: boolean }>).find((d) => d.bombona === codigo)!
        .arrancada;
    assert.equal(await arrancada('BO-0002'), false);
    assert.equal((await chamar('/simulacao/comandos', { tipo: 'VENDA_SILENCIOSA', bombona: 'BO-0002' })).status, 201);
    assert.equal(await arrancada('BO-0002'), true);
    assert.equal(await arrancada('BO-0001'), false);

    // A parada não a acha: extraviada, continua sem rastreador.
    const { roteiro, parada } = sair(ctx);
    registrarTroca(ctx, roteiro.id, parada(1).id, { encontradas: [{ codigo: 'BO-0001', litros: 30 }] });
    concluirRoteiro(ctx, roteiro.id);
    assert.equal(bombona(ctx, 'BO-0002').status, 'EXTRAVIADA');
    assert.equal(await arrancada('BO-0002'), true);

    // Recuperada (ganha rastreador novo) e levada ao pátio.
    coletar(ctx, 'BO-0002');
    assert.equal(await arrancada('BO-0002'), false);
    const { dispositivoId } = ctx.db.prepare("SELECT dispositivo_id AS dispositivoId FROM bombonas WHERE codigo = 'BO-0002'").get() as {
      dispositivoId: string;
    };
    processarLeitura(ctx, dispositivoId, { ...ctx.config.patio, precisao: 5, bateria: 100, registradoEm: new Date(Date.now() + 1000).toISOString() });
    assert.equal(bombona(ctx, 'BO-0002').status, 'PATIO');

    // Nova entrega dela no cliente: rastreador funcionando.
    planejarDia(ctx, TERCA);
    iniciarRoteiros(ctx, TERCA);
    const [r2] = roteirosDoDia(ctx.db, ctx.config, TERCA).roteiros;
    assert.deepEqual(doRoteiro(ctx, r2.id), ['BO-0001', 'BO-0002']);
    registrarTroca(ctx, r2.id, r2.paradas[0].id, { encontradas: [{ codigo: 'BO-0018', litros: 30 }, { codigo: 'BO-0019', litros: 30 }] });
    assert.deepEqual([bombona(ctx, 'BO-0002').status, bombona(ctx, 'BO-0002').clienteId], ['EM_CLIENTE', 1]);
    assert.equal(await arrancada('BO-0002'), false);
  });

  it('/simulacao/estado traz operacao e roteiros em andamento com paradas', async () => {
    const { ctx } = cenario([{ cliente: 1, qtd: 2 }]);
    const chamar = await api(ctx);
    estadoOperacao(ctx);
    avancarOperacao(ctx); // furgões saem
    const [roteiro] = roteirosDoDia(ctx.db, ctx.config, SEGUNDA).roteiros;

    const estado = (await chamar('/simulacao/estado')).corpo;
    assert.deepEqual(estado.operacao, { data: SEGUNDA, pausado: false });
    assert.equal(estado.roteiros.length, 1);
    const [r] = estado.roteiros;
    assert.equal(r.id, roteiro.id);
    assert.equal(r.numero, 1);
    assert.deepEqual(r.bombonas, ['BO-0018', 'BO-0019']);
    const cliente = ctx.db.prepare('SELECT nome, lat, lng FROM clientes WHERE id = 1').get() as { nome: string; lat: number; lng: number };
    assert.deepEqual(r.paradas, [
      {
        id: roteiro.paradas[0].id,
        ordem: 1,
        status: 'PENDENTE',
        clienteId: 1,
        nome: cliente.nome,
        lat: cliente.lat,
        lng: cliente.lng,
        litrosEsperados: litrosEsperados(ctx.db, 1, ctx.config.coletaHistoricoN),
        procuradas: [
          { codigo: 'BO-0001', capacidadeL: 50 },
          { codigo: 'BO-0002', capacidadeL: 50 },
        ],
      },
    ]);
    const d = estado.dispositivos.find((x: { bombona: string }) => x.bombona === 'BO-0018');
    assert.deepEqual([d.roteiroId, d.clienteId], [roteiro.id, 1]);
    const parada = estado.dispositivos.find((x: { bombona: string }) => x.bombona === 'BO-0009');
    assert.deepEqual([parada.roteiroId, parada.clienteId], [null, 6]);

    // Parada feita não precisa mais das procuradas.
    registrarTroca(ctx, roteiro.id, roteiro.paradas[0].id, { encontradas: [{ codigo: 'BO-0001', litros: 30 }] });
    const [feita] = (await chamar('/simulacao/estado')).corpo.roteiros[0].paradas;
    assert.deepEqual([feita.status, feita.procuradas], ['FEITA', []]);

    concluirRoteiro(ctx, roteiro.id);
    assert.deepEqual((await chamar('/simulacao/estado')).corpo.roteiros, []);
  });
});
