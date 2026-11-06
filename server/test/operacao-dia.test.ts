import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Config } from '../src/config.ts';
import type { Contexto } from '../src/contexto.ts';
import { criarContrato, editarContrato } from '../src/contratos.ts';
import { bombonaDto } from '../src/consultas.ts';
import type { Evento } from '../src/eventos.ts';
import {
  avancarOperacao,
  continuar,
  estadoOperacao,
  iniciarRoteiros,
  pausar,
  planejarDia,
  roteirosDoDia,
} from '../src/operacao.ts';
import { criarContexto, subirApi } from './apoio.ts';

type Contrato = { cliente: number; freq: 'DIARIA' | 'SEMANAL'; dias?: number[]; qtd: number };

/** Contexto sem contratos do seed, com os contratos pedidos (início em 02/11/2026). */
function cenario(contratos: Contrato[] = [], ajustes: Partial<Config> = {}) {
  const ctx = criarContexto({ fasePausaS: 0, ...ajustes });
  ctx.db.exec('DELETE FROM contratos');
  // Estes testes contam com as 5 vazias do pátio do seed antigo: as demais do estoque (RN24) saem de cena.
  ctx.db.exec(`UPDATE bombonas SET status = 'EXTRAVIADA' WHERE status = 'PATIO'
                 AND id NOT IN (SELECT id FROM bombonas WHERE status = 'PATIO' ORDER BY codigo LIMIT 5)`);
  const ids = contratos.map(
    (c) =>
      criarContrato(ctx, { clienteId: c.cliente, quantidade: c.qtd, frequencia: c.freq, diasSemana: c.dias ?? [], inicio: '2026-11-02' }).id,
  );
  return { ctx, ids };
}

const clientesDoDia = (ctx: Contexto, data: string) =>
  roteirosDoDia(ctx.db, ctx.config, data).roteiros.flatMap((r) => r.paradas.map((p) => p.cliente.id));

const contarParadas = (ctx: Contexto, data: string) =>
  (ctx.db.prepare('SELECT COUNT(*) AS n FROM paradas WHERE data = ?').get(data) as { n: number }).n;

const noPatio = (ctx: Contexto) =>
  (ctx.db.prepare("SELECT COUNT(*) AS n FROM bombonas WHERE status = 'PATIO' AND roteiro_id IS NULL").get() as { n: number }).n;

const SEGUNDA = '2026-11-09';
const TERCA = '2026-11-10';

describe('planejamento do dia (RN20, RN23)', () => {
  it('gera as paradas do dia a partir dos contratos e respeita a capacidade', () => {
    const { ctx } = cenario([
      { cliente: 1, freq: 'DIARIA', qtd: 2 },
      { cliente: 6, freq: 'SEMANAL', dias: [2], qtd: 1 },
    ]);
    planejarDia(ctx, SEGUNDA); // segunda: só o diário
    const { roteiros, naoAtendidas } = roteirosDoDia(ctx.db, ctx.config, SEGUNDA);
    assert.deepEqual(clientesDoDia(ctx, SEGUNDA), [1]);
    assert.deepEqual(naoAtendidas, []);
    const [r] = roteiros;
    assert.equal(r.numero, 1);
    assert.equal(r.status, 'PLANEJADO');
    assert.equal(r.capacidade, 8);
    const [p] = r.paradas;
    assert.equal(p.ordem, 1);
    assert.equal(p.motivo, 'COLETA');
    assert.equal(p.vazias, 2);
    assert.equal(p.demanda, 2); // max(2 vazias, 2 bombonas no cliente 1)
    assert.equal(p.status, 'PENDENTE');
    assert.equal(p.resultado, null);
    assert.equal(r.carga, 2);

    planejarDia(ctx, TERCA); // terça: os dois
    assert.deepEqual(clientesDoDia(ctx, TERCA).sort((a, b) => a - b), [1, 6]);
  });

  it('nenhum roteiro passa da capacidade; o que não cabe na frota fica não atendido', () => {
    // Capacidade 3 e um furgão só: clientes 1 (2), 6 (2) e 5 (3 bombonas no cliente, mais que 2 vazias).
    const { ctx } = cenario(
      [
        { cliente: 1, freq: 'DIARIA', qtd: 2 },
        { cliente: 6, freq: 'DIARIA', qtd: 2 },
        { cliente: 5, freq: 'DIARIA', qtd: 2 },
        { cliente: 7, freq: 'DIARIA', qtd: 4 },
      ],
      { furgaoCapacidade: 3, frotaMaxima: 1 },
    );
    planejarDia(ctx, SEGUNDA);
    const { roteiros, naoAtendidas } = roteirosDoDia(ctx.db, ctx.config, SEGUNDA);
    assert.equal(roteiros.length, 1);
    assert.ok(roteiros[0].carga <= 3);
    assert.equal(roteiros[0].paradas.length + naoAtendidas.length, 4);
    const cinco = [...roteiros[0].paradas, ...naoAtendidas].find((p) => p.cliente.id === 5)!;
    assert.equal(cinco.demanda, 3);
    for (const p of naoAtendidas) {
      assert.equal(p.status, 'NAO_ATENDIDA');
      assert.equal(p.ordem, null);
      assert.deepEqual(p.resultado?.deixadas, []);
      assert.equal(typeof p.resultado?.observacao, 'string');
    }
    const foraDaFrota = naoAtendidas.filter((p) => p.demanda <= 3);
    assert.ok(foraDaFrota.length >= 1);
    for (const p of foraDaFrota) assert.equal(p.resultado?.observacao, 'não coube na frota do dia');
  });

  it('domingo não gera parada', () => {
    const { ctx, ids } = cenario([{ cliente: 1, freq: 'DIARIA', qtd: 2 }]);
    editarContrato(ctx, ids[0], { quantidade: 2, frequencia: 'DIARIA', inicio: '2026-11-02', situacao: 'ENCERRADO' });
    planejarDia(ctx, '2026-11-15');
    assert.equal(contarParadas(ctx, '2026-11-15'), 0);
    assert.deepEqual(roteirosDoDia(ctx.db, ctx.config, '2026-11-15'), { data: '2026-11-15', roteiros: [], naoAtendidas: [] });
    // a retirada pendente espera o próximo dia de operação
    planejarDia(ctx, '2026-11-16');
    assert.equal(contarParadas(ctx, '2026-11-16'), 1);
  });

  it('planejar duas vezes não duplica', () => {
    const { ctx } = cenario([
      { cliente: 1, freq: 'DIARIA', qtd: 2 },
      { cliente: 6, freq: 'DIARIA', qtd: 1 },
    ]);
    planejarDia(ctx, SEGUNDA);
    planejarDia(ctx, SEGUNDA);
    assert.equal(contarParadas(ctx, SEGUNDA), 2);
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM roteiros WHERE data = ?').get(SEGUNDA) as { n: number }).n, 1);
  });

  it('contrato criado depois do planejamento não entra no dia, entra no próximo', () => {
    const { ctx } = cenario([{ cliente: 1, freq: 'DIARIA', qtd: 2 }]);
    planejarDia(ctx, SEGUNDA);
    criarContrato(ctx, { clienteId: 6, quantidade: 1, frequencia: 'DIARIA', inicio: '2026-11-02' });
    planejarDia(ctx, SEGUNDA);
    assert.deepEqual(clientesDoDia(ctx, SEGUNDA), [1]);
    planejarDia(ctx, TERCA);
    assert.deepEqual(clientesDoDia(ctx, TERCA).sort((a, b) => a - b), [1, 6]);
  });

  it('encerrado gera RETIRADA com 0 vazias no dia seguinte, uma vez só', () => {
    const { ctx, ids } = cenario([{ cliente: 1, freq: 'DIARIA', qtd: 2 }]);
    planejarDia(ctx, SEGUNDA);
    editarContrato(ctx, ids[0], { quantidade: 2, frequencia: 'DIARIA', inicio: '2026-11-02', situacao: 'ENCERRADO' });
    planejarDia(ctx, TERCA);
    const [p] = roteirosDoDia(ctx.db, ctx.config, TERCA).roteiros.flatMap((r) => r.paradas);
    assert.equal(p.cliente.id, 1);
    assert.equal(p.motivo, 'RETIRADA');
    assert.equal(p.vazias, 0);
    assert.equal(p.demanda, 2);
    const k = ctx.db.prepare('SELECT retirada_pendente AS r FROM contratos WHERE id = ?').get(ids[0]) as { r: number };
    assert.equal(k.r, 0);
    planejarDia(ctx, '2026-11-11');
    assert.equal(contarParadas(ctx, '2026-11-11'), 0);
  });

  it('cliente com contrato encerrado e novo contrato no mesmo dia recebe uma parada só', () => {
    const { ctx, ids } = cenario([{ cliente: 1, freq: 'DIARIA', qtd: 2 }]);
    editarContrato(ctx, ids[0], { quantidade: 2, frequencia: 'DIARIA', inicio: '2026-11-02', situacao: 'ENCERRADO' });
    criarContrato(ctx, { clienteId: 1, quantidade: 3, frequencia: 'DIARIA', inicio: '2026-11-02' });
    planejarDia(ctx, SEGUNDA);
    const paradas = roteirosDoDia(ctx.db, ctx.config, SEGUNDA).roteiros.flatMap((r) => r.paradas);
    assert.deepEqual(paradas.map((p) => [p.motivo, p.vazias]), [['COLETA', 3]]);
    const k = ctx.db.prepare('SELECT retirada_pendente AS r FROM contratos WHERE id = ?').get(ids[0]) as { r: number };
    assert.equal(k.r, 0);
  });

  it('retirada pendente de cliente com contrato novo ativo é descartada, qualquer que seja a data', () => {
    const { ctx, ids } = cenario([{ cliente: 1, freq: 'DIARIA', qtd: 2 }]);
    editarContrato(ctx, ids[0], { quantidade: 2, frequencia: 'DIARIA', inicio: '2026-11-02', situacao: 'ENCERRADO' });
    criarContrato(ctx, { clienteId: 1, quantidade: 3, frequencia: 'SEMANAL', diasSemana: [2], inicio: '2026-11-02' });
    planejarDia(ctx, SEGUNDA);
    assert.equal(contarParadas(ctx, SEGUNDA), 0);
    const k = ctx.db.prepare('SELECT retirada_pendente AS r FROM contratos WHERE id = ?').get(ids[0]) as { r: number };
    assert.equal(k.r, 0);
    planejarDia(ctx, TERCA);
    const paradas = roteirosDoDia(ctx.db, ctx.config, TERCA).roteiros.flatMap((r) => r.paradas);
    assert.deepEqual(paradas.map((p) => [p.cliente.id, p.motivo, p.vazias]), [[1, 'COLETA', 3]]);
  });

  it('retirada de cliente sem nenhuma bombona não gera visita, e a pendência é zerada', () => {
    const { ctx } = cenario();
    const clienteId = Number(
      ctx.db
        .prepare("INSERT INTO clientes (nome, tipo, cidade, endereco, lat, lng) VALUES ('Cliente vazio', 'x', 'Cianorte', 'rua', -23.66, -52.6)")
        .run().lastInsertRowid,
    );
    const { id } = criarContrato(ctx, { clienteId, quantidade: 1, frequencia: 'DIARIA', inicio: '2026-11-02' });
    editarContrato(ctx, id, { quantidade: 1, frequencia: 'DIARIA', inicio: '2026-11-02', situacao: 'ENCERRADO' });
    planejarDia(ctx, SEGUNDA);
    assert.equal(contarParadas(ctx, SEGUNDA), 0);
    const k = ctx.db.prepare('SELECT retirada_pendente AS r FROM contratos WHERE id = ?').get(id) as { r: number };
    assert.equal(k.r, 0);
  });
});

describe('saída dos furgões (RN24)', () => {
  it('iniciar carrega vazias do pátio no furgão (EM_ROTA, roteiro_id, cliente da parada)', () => {
    const { ctx } = cenario([{ cliente: 1, freq: 'DIARIA', qtd: 2 }]);
    const eventos: Evento[] = [];
    ctx.eventos.ouvir((e) => eventos.push(e));
    planejarDia(ctx, SEGUNDA);
    iniciarRoteiros(ctx, SEGUNDA);
    const [r] = roteirosDoDia(ctx.db, ctx.config, SEGUNDA).roteiros;
    assert.equal(r.status, 'EM_ANDAMENTO');
    const carregadas = ctx.db
      .prepare('SELECT id, codigo, status, cliente_id AS clienteId, roteiro_id AS roteiroId FROM bombonas WHERE roteiro_id IS NOT NULL ORDER BY codigo')
      .all() as Array<{ id: number; codigo: string; status: string; clienteId: number; roteiroId: number }>;
    // as duas primeiras vazias do pátio, por código
    assert.deepEqual(
      carregadas.map((b) => [b.codigo, b.status, b.clienteId, b.roteiroId]),
      [
        ['BO-0018', 'EM_ROTA', 1, r.id],
        ['BO-0019', 'EM_ROTA', 1, r.id],
      ],
    );
    const mov = ctx.db
      .prepare("SELECT tipo, cliente_id AS clienteId FROM movimentacoes WHERE bombona_id = ? ORDER BY id DESC LIMIT 1")
      .get(carregadas[0].id) as { tipo: string; clienteId: number };
    assert.deepEqual({ ...mov }, { tipo: 'SAIDA_PARA_ENTREGA', clienteId: 1 });
    assert.equal(bombonaDto(ctx.db, ctx.config, carregadas[0].id)!.roteiroId, r.id);
    assert.equal(noPatio(ctx), 3);
    assert.ok(eventos.some((e) => e.tipo === 'roteiro' && (e.dados as any).status === 'EM_ANDAMENTO'));
    assert.ok(eventos.some((e) => e.tipo === 'bombona' && (e.dados as any).codigo === 'BO-0018'));

    // iniciar de novo não carrega mais nada
    iniciarRoteiros(ctx, SEGUNDA);
    assert.equal(noPatio(ctx), 3);
  });

  it('carrega vazias da capacidade que o cliente já usa, quando há no pátio', () => {
    // Cliente 5 tem bombonas de 200 L; o 1, de 50 L. Duas das 5 vazias do pátio passam a ser de 200 L.
    const { ctx } = cenario([
      { cliente: 1, freq: 'DIARIA', qtd: 2 },
      { cliente: 5, freq: 'DIARIA', qtd: 2 },
    ]);
    ctx.db.exec("UPDATE bombonas SET capacidade_l = 200 WHERE codigo IN ('BO-0019', 'BO-0021')");
    planejarDia(ctx, SEGUNDA);
    iniciarRoteiros(ctx, SEGUNDA);
    const doCliente = (clienteId: number) =>
      (
        ctx.db
          .prepare('SELECT codigo, capacidade_l AS capacidade FROM bombonas WHERE roteiro_id IS NOT NULL AND cliente_id = ? ORDER BY codigo')
          .all(clienteId) as Array<{ codigo: string; capacidade: number }>
      ).map((b) => `${b.codigo} ${b.capacidade}`);
    assert.deepEqual(doCliente(5), ['BO-0019 200', 'BO-0021 200']);
    assert.deepEqual(doCliente(1), ['BO-0018 50', 'BO-0020 50']);
  });

  it('sem vazias suficientes a parada vira NAO_ATENDIDA', () => {
    // Pátio do seed: 5 vazias. Duas paradas de 4: a primeira da rota leva 4, a segunda fica sem.
    const { ctx } = cenario([
      { cliente: 1, freq: 'DIARIA', qtd: 4 },
      { cliente: 6, freq: 'DIARIA', qtd: 4 },
    ]);
    planejarDia(ctx, SEGUNDA);
    iniciarRoteiros(ctx, SEGUNDA);
    const { roteiros, naoAtendidas } = roteirosDoDia(ctx.db, ctx.config, SEGUNDA);
    assert.equal(roteiros.length, 1);
    assert.equal(roteiros[0].paradas.length, 1);
    assert.equal(roteiros[0].paradas[0].ordem, 1);
    assert.equal(naoAtendidas.length, 1);
    assert.equal(naoAtendidas[0].status, 'NAO_ATENDIDA');
    assert.equal(naoAtendidas[0].resultado?.observacao, 'sem bombonas vazias no pátio');
    assert.equal(noPatio(ctx), 1);
  });

  it('roteiro sem nenhuma parada atendível é apagado', () => {
    const { ctx } = cenario([{ cliente: 1, freq: 'DIARIA', qtd: 6 }]);
    planejarDia(ctx, SEGUNDA);
    iniciarRoteiros(ctx, SEGUNDA);
    const { roteiros, naoAtendidas } = roteirosDoDia(ctx.db, ctx.config, SEGUNDA);
    assert.deepEqual(roteiros, []);
    assert.equal(naoAtendidas.length, 1);
    assert.equal(noPatio(ctx), 5);
  });
});

describe('relógio da operação', () => {
  const fase = (ctx: Contexto) => {
    const e = estadoOperacao(ctx);
    return `${e.fase} ${e.data} ${e.diaSemana}`;
  };

  it('fases: MANHA → ROTAS → FIM → MANHA do próximo dia útil; sábado vai para segunda', () => {
    const { ctx } = cenario([{ cliente: 1, freq: 'DIARIA', qtd: 1 }]);
    const eventos: Evento[] = [];
    ctx.eventos.ouvir((e) => eventos.push(e));
    assert.deepEqual(estadoOperacao(ctx), { data: SEGUNDA, diaSemana: 1, fase: 'MANHA', pausado: false });
    assert.equal(contarParadas(ctx, SEGUNDA), 1); // a manhã já planeja o dia

    avancarOperacao(ctx);
    assert.equal(fase(ctx), `ROTAS ${SEGUNDA} 1`);
    assert.equal(roteirosDoDia(ctx.db, ctx.config, SEGUNDA).roteiros[0].status, 'EM_ANDAMENTO');
    assert.ok(eventos.some((e) => e.tipo === 'operacao' && (e.dados as any).fase === 'ROTAS'));

    avancarOperacao(ctx); // furgão ainda na rua
    assert.equal(fase(ctx), `ROTAS ${SEGUNDA} 1`);

    ctx.db.prepare("UPDATE roteiros SET status = 'CONCLUIDO' WHERE data = ?").run(SEGUNDA);
    avancarOperacao(ctx);
    assert.equal(fase(ctx), `FIM ${SEGUNDA} 1`);

    avancarOperacao(ctx);
    assert.equal(fase(ctx), `MANHA ${TERCA} 2`);
    assert.equal(contarParadas(ctx, TERCA), 1);

    ctx.db.prepare("UPDATE operacao SET data = '2026-11-14', fase = 'FIM'").run();
    avancarOperacao(ctx);
    assert.equal(fase(ctx), 'MANHA 2026-11-16 1');
  });

  it('a primeira chamada só cria a operação na manhã da data inicial', () => {
    const { ctx } = cenario([{ cliente: 1, freq: 'DIARIA', qtd: 1 }]);
    avancarOperacao(ctx);
    assert.equal(fase(ctx), `MANHA ${SEGUNDA} 1`);
    assert.equal(contarParadas(ctx, SEGUNDA), 1);
    avancarOperacao(ctx);
    assert.equal(fase(ctx), `ROTAS ${SEGUNDA} 1`);
  });

  it('manhã e fim do dia esperam fasePausaS', () => {
    const { ctx } = cenario([], { fasePausaS: 5 });
    estadoOperacao(ctx);
    const t0 = Date.parse('2026-11-06T12:00:00.000Z');
    ctx.db.prepare('UPDATE operacao SET fase_desde = ?').run(new Date(t0).toISOString());
    avancarOperacao(ctx, t0 + 4_000);
    assert.equal(estadoOperacao(ctx).fase, 'MANHA');
    avancarOperacao(ctx, t0 + 5_000);
    assert.equal(estadoOperacao(ctx).fase, 'ROTAS');
    avancarOperacao(ctx, t0 + 6_000);
    assert.equal(estadoOperacao(ctx).fase, 'FIM');
    avancarOperacao(ctx, t0 + 10_000);
    assert.equal(estadoOperacao(ctx).fase, 'FIM');
    avancarOperacao(ctx, t0 + 11_000);
    assert.equal(fase(ctx), `MANHA ${TERCA} 2`);
  });

  it('pausado não muda de fase nem de data', () => {
    const { ctx } = cenario([{ cliente: 1, freq: 'DIARIA', qtd: 1 }]);
    estadoOperacao(ctx);
    assert.equal(pausar(ctx).pausado, true);
    for (let i = 0; i < 5; i++) avancarOperacao(ctx, Date.now() + 60_000);
    assert.deepEqual(estadoOperacao(ctx), { data: SEGUNDA, diaSemana: 1, fase: 'MANHA', pausado: true });
    assert.equal(noPatio(ctx), 5);
    assert.equal(continuar(ctx).pausado, false);
    avancarOperacao(ctx);
    assert.equal(estadoOperacao(ctx).fase, 'ROTAS');
  });

  it('a pausa estende a fase pelo tempo pausado', () => {
    const { ctx } = cenario([], { fasePausaS: 5 });
    estadoOperacao(ctx);
    const t0 = Date.parse('2026-11-06T12:00:00.000Z');
    ctx.db.prepare('UPDATE operacao SET fase_desde = ?').run(new Date(t0).toISOString());
    pausar(ctx, t0 + 3_000);
    continuar(ctx, t0 + 60_000); // 57 s pausado
    avancarOperacao(ctx, t0 + 61_000); // 4 s de fase
    assert.equal(estadoOperacao(ctx).fase, 'MANHA');
    avancarOperacao(ctx, t0 + 62_000);
    assert.equal(estadoOperacao(ctx).fase, 'ROTAS');
  });
});

describe('API da operação', () => {
  let encerrar: Array<() => unknown> = [];
  afterEach(async () => {
    await Promise.all(encerrar.map((f) => f()));
    encerrar = [];
  });

  it('GET /operacao, pausar, continuar e GET /roteiros', async () => {
    const { ctx } = cenario([{ cliente: 1, freq: 'DIARIA', qtd: 2 }]);
    const api = await subirApi(ctx);
    encerrar.push(api.fechar);
    const json = async (caminho: string, metodo = 'GET') => {
      const r = await fetch(`${api.url}${caminho}`, { method: metodo });
      return { status: r.status, corpo: await r.json() };
    };
    assert.deepEqual((await json('/operacao')).corpo, { data: SEGUNDA, diaSemana: 1, fase: 'MANHA', pausado: false });
    assert.equal((await json('/operacao/pausar', 'POST')).corpo.pausado, true);
    assert.equal((await json('/operacao')).corpo.pausado, true);
    assert.equal((await json('/operacao/continuar', 'POST')).corpo.pausado, false);

    const hoje = (await json('/roteiros')).corpo;
    assert.equal(hoje.data, SEGUNDA);
    assert.equal(hoje.roteiros.length, 1);
    assert.equal(hoje.roteiros[0].paradas[0].cliente.nome, 'Restaurante Sabor da Terra');
    assert.deepEqual((await json(`/roteiros?data=${TERCA}`)).corpo, { data: TERCA, roteiros: [], naoAtendidas: [] });
    assert.equal((await json('/roteiros?data=amanha')).status, 400);
  });

  it('bombona em furgão dentro da cerca do destino continua EM_ROTA (RN04 não vale)', async () => {
    const { ctx } = cenario([{ cliente: 1, freq: 'DIARIA', qtd: 1 }]);
    const api = await subirApi(ctx);
    encerrar.push(api.fechar);
    planejarDia(ctx, SEGUNDA);
    iniciarRoteiros(ctx, SEGUNDA);
    const { token } = ctx.db
      .prepare("SELECT d.token FROM dispositivos d JOIN bombonas b ON b.dispositivo_id = d.id WHERE b.codigo = 'BO-0018'")
      .get() as { token: string };
    const cliente = ctx.db.prepare('SELECT lat, lng FROM clientes WHERE id = 1').get() as { lat: number; lng: number };
    const r = await fetch(`${api.url}/telemetria`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lat: cliente.lat, lng: cliente.lng, bateria: 80 }),
    });
    assert.equal(r.status, 202);
    assert.equal((await r.json()).status, 'EM_ROTA');
    const b = ctx.db.prepare("SELECT status, roteiro_id AS roteiroId FROM bombonas WHERE codigo = 'BO-0018'").get() as {
      status: string;
      roteiroId: number | null;
    };
    assert.equal(b.status, 'EM_ROTA');
    assert.notEqual(b.roteiroId, null);
    const leituras = ctx.db.prepare("SELECT COUNT(*) AS n FROM leituras l JOIN bombonas b ON b.id = l.bombona_id WHERE b.codigo = 'BO-0018'").get() as {
      n: number;
    };
    assert.equal(leituras.n, 1);
  });
});
