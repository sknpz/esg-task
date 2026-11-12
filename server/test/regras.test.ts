import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Contexto } from '../src/contexto.ts';
import type { Evento } from '../src/eventos.ts';
import { continuar, definirVelocidade, estadoOperacao, pausar } from '../src/operacao.ts';
import { processarLeitura, verificarSemSinal } from '../src/regras.ts';
import { criarContexto, subirApi } from './apoio.ts';

type Ponto = { lat: number; lng: number };
/** Ponto `metros` ao norte de `p`. */
const aoNorte = (p: Ponto, metros: number) => ({ lat: p.lat + metros / 111_195, lng: p.lng });

let encerrar: Array<() => unknown> = [];
afterEach(async () => {
  await Promise.all(encerrar.map((f) => f()));
  encerrar = [];
});

async function cenario() {
  const ctx = criarContexto();
  const api = await subirApi(ctx);
  encerrar.push(api.fechar);
  const eventos: Evento[] = [];
  encerrar.push(ctx.eventos.ouvir((e) => eventos.push(e)));

  const token = (codigo: string) =>
    (ctx.db.prepare('SELECT d.token FROM dispositivos d JOIN bombonas b ON b.dispositivo_id = d.id WHERE b.codigo = ?').get(codigo) as { token: string }).token;

  const enviar = async (codigo: string, ponto: Ponto, extra: Record<string, unknown> = {}) => {
    const resposta = await fetch(`${api.url}/telemetria`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(codigo)}` },
      body: JSON.stringify({ ...ponto, bateria: 80, ...extra }),
    });
    assert.equal(resposta.status, 202, await resposta.clone().text());
    return resposta.json();
  };

  const bombona = async (codigo: string) => (await fetch(`${api.url}/bombonas/${codigo}`)).json();
  const abertos = async (codigo: string) =>
    (await bombona(codigo)).alertas.filter((a: any) => a.status === 'ABERTO').map((a: any) => a.tipo).sort();

  return { ctx, api, eventos, token, enviar, bombona, abertos };
}

const clienteDe = async (c: Awaited<ReturnType<typeof cenario>>, codigo: string): Promise<Ponto> => (await c.bombona(codigo)).localEsperado;

describe('POST /api/telemetria (contrato do dispositivo)', () => {
  it('recusa token ausente ou desconhecido (RN16)', async () => {
    const { api } = await cenario();
    const corpo = JSON.stringify({ lat: -23.6, lng: -52.6, bateria: 50 });
    const semToken = await fetch(`${api.url}/telemetria`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo });
    assert.equal(semToken.status, 401);
    const tokenFalso = await fetch(`${api.url}/telemetria`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nao-existe' },
      body: corpo,
    });
    assert.equal(tokenFalso.status, 401);
  });

  it('recusa payload inválido com 400', async () => {
    const { api, token } = await cenario();
    for (const corpo of [{ lat: 120, lng: 0, bateria: 50 }, { lat: 0, lng: 0, bateria: 150 }, { lat: 0, lng: 0 }, { lat: 0, lng: 0, bateria: 5, registradoEm: 'ontem' }]) {
      const r = await fetch(`${api.url}/telemetria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token('BO-0001')}` },
        body: JSON.stringify(corpo),
      });
      assert.equal(r.status, 400, JSON.stringify(corpo));
    }
  });
});

describe('motor de regras', () => {
  it('só abre FORA_DA_AREA na segunda leitura fora (RN07) e não duplica (RN12)', async () => {
    const c = await cenario();
    const casa = await clienteDe(c, 'BO-0001');
    await c.enviar('BO-0001', aoNorte(casa, 400));
    assert.deepEqual(await c.abertos('BO-0001'), []);
    await c.enviar('BO-0001', aoNorte(casa, 450));
    assert.deepEqual(await c.abertos('BO-0001'), ['FORA_DA_AREA']);
    await c.enviar('BO-0001', aoNorte(casa, 500));
    assert.deepEqual(await c.abertos('BO-0001'), ['FORA_DA_AREA']);
    assert.equal((await c.bombona('BO-0001')).status, 'EM_CLIENTE');
  });

  it('uma leitura dentro da cerca zera a contagem', async () => {
    const c = await cenario();
    const casa = await clienteDe(c, 'BO-0001');
    await c.enviar('BO-0001', aoNorte(casa, 400));
    await c.enviar('BO-0001', aoNorte(casa, 10));
    await c.enviar('BO-0001', aoNorte(casa, 400));
    assert.deepEqual(await c.abertos('BO-0001'), []);
  });

  it('desconta a precisão do GPS (RN06)', async () => {
    const c = await cenario();
    const casa = await clienteDe(c, 'BO-0001');
    await c.enviar('BO-0001', aoNorte(casa, 180), { precisao: 40 });
    await c.enviar('BO-0001', aoNorte(casa, 180), { precisao: 40 });
    assert.deepEqual(await c.abertos('BO-0001'), []);
  });

  it('marca como EXTRAVIADA a mais de 2 km e conta incidente para o cliente (RN08, RN14)', async () => {
    const c = await cenario();
    const casa = await clienteDe(c, 'BO-0001');
    await c.enviar('BO-0001', aoNorte(casa, 2500));
    await c.enviar('BO-0001', aoNorte(casa, 2600));
    const b = await c.bombona('BO-0001');
    assert.equal(b.status, 'EXTRAVIADA');
    assert.deepEqual(await c.abertos('BO-0001'), ['EXTRAVIO', 'FORA_DA_AREA']);
    assert.equal(b.alertas.find((a: any) => a.tipo === 'EXTRAVIO').severidade, 'CRITICO');

    const clientes = await (await fetch(`${c.api.url}/clientes`)).json();
    assert.equal(clientes.find((x: any) => x.id === b.cliente.id).incidentes, 1);
    const ind = await (await fetch(`${c.api.url}/indicadores`)).json();
    assert.equal(ind.porStatus.EXTRAVIADA, 1);
    assert.equal(ind.valorEmRisco, 150);
  });

  it('resolve sozinho quando a bombona volta para a cerca (RN09)', async () => {
    const c = await cenario();
    const casa = await clienteDe(c, 'BO-0001');
    await c.enviar('BO-0001', aoNorte(casa, 2500));
    await c.enviar('BO-0001', aoNorte(casa, 2600));
    await c.enviar('BO-0001', casa);
    const b = await c.bombona('BO-0001');
    assert.equal(b.status, 'EM_CLIENTE');
    assert.deepEqual(await c.abertos('BO-0001'), []);
    assert.ok(b.alertas.every((a: any) => a.resolvidoPor === 'SISTEMA'));
  });

  it('bombona em rota não gera alerta e conclui a entrega ao chegar (RN13, RN04)', async () => {
    const c = await cenario();
    // Saída manual do pátio para o cliente 3 (o seed não tem bombona em rota).
    const saida = await fetch(`${c.api.url}/bombonas/BO-0023/entrega`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clienteId: 3 }),
    });
    assert.equal(saida.status, 200, await saida.clone().text());
    const emRota = await c.bombona('BO-0023');
    assert.equal(emRota.status, 'EM_ROTA');
    await c.enviar('BO-0023', aoNorte(emRota.destino, 5000));
    await c.enviar('BO-0023', aoNorte(emRota.destino, 3000));
    assert.deepEqual(await c.abertos('BO-0023'), []);
    await c.enviar('BO-0023', aoNorte(emRota.destino, 30));
    const chegou = await c.bombona('BO-0023');
    assert.equal(chegou.status, 'EM_CLIENTE');
    assert.equal(chegou.movimentacoes[0].tipo, 'ENTREGA_CONCLUIDA');
  });

  it('abre e fecha BATERIA_BAIXA com histerese (RN11)', async () => {
    const c = await cenario();
    const casa = await clienteDe(c, 'BO-0002');
    await c.enviar('BO-0002', casa, { bateria: 15 });
    assert.deepEqual(await c.abertos('BO-0002'), ['BATERIA_BAIXA']);
    await c.enviar('BO-0002', casa, { bateria: 25 });
    assert.deepEqual(await c.abertos('BO-0002'), ['BATERIA_BAIXA']);
    await c.enviar('BO-0002', casa, { bateria: 95 });
    assert.deepEqual(await c.abertos('BO-0002'), []);
  });

  it('abre SEM_SINAL na varredura e fecha quando chega leitura (RN10)', async () => {
    const c = await cenario();
    const abertos = verificarSemSinal(c.ctx, Date.now() + (c.ctx.config.semSinalSegundos + 5) * 1000);
    assert.equal(abertos.length, 107);
    assert.equal(verificarSemSinal(c.ctx, Date.now() + 3_600_000).length, 0, 'não duplica');
    await c.enviar('BO-0004', await clienteDe(c, 'BO-0004'));
    assert.deepEqual(await c.abertos('BO-0004'), []);
  });

  it('guarda leitura atrasada sem mudar o estado', async () => {
    const c = await cenario();
    const casa = await clienteDe(c, 'BO-0001');
    const r = await c.enviar('BO-0001', aoNorte(casa, 5000), { registradoEm: new Date(Date.now() - 3_600_000).toISOString() });
    assert.equal(r.atrasada, true);
    const trilha = await (await fetch(`${c.api.url}/bombonas/BO-0001/trilha`)).json();
    assert.equal(trilha.length, 1);
    assert.equal((await c.bombona('BO-0001')).distanciaM < 150, true);
  });

  it('emite eventos de bombona e alerta para o painel', async () => {
    const c = await cenario();
    const casa = await clienteDe(c, 'BO-0001');
    await c.enviar('BO-0001', aoNorte(casa, 2500));
    await c.enviar('BO-0001', aoNorte(casa, 2600));
    const tipos = c.eventos.map((e) => e.tipo);
    assert.equal(tipos.filter((t) => t === 'bombona').length, 2);
    assert.equal(tipos.filter((t) => t === 'alerta').length, 2);
  });
});

describe('GET /api/eventos', () => {
  it('entrega eventos em formato SSE', async () => {
    const c = await cenario();
    const controle = new AbortController();
    const resposta = await fetch(`${c.api.url}/eventos`, { signal: controle.signal });
    assert.equal(resposta.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const leitor = resposta.body!.getReader();
    await leitor.read(); // "retry:"
    await c.enviar('BO-0005', await clienteDe(c, 'BO-0005'));
    const { value } = await leitor.read();
    assert.match(new TextDecoder().decode(value), /^event: bombona\ndata: \{.*"codigo":"BO-0005"/);
    controle.abort();
  });
});

describe('sem sinal e o player da simulação', () => {
  it('pausado, a varredura não abre SEM_SINAL', () => {
    const ctx = criarContexto({ semSinalSegundos: 45 });
    estadoOperacao(ctx); // nasce pausado
    ctx.db.prepare('UPDATE dispositivos SET ultimo_sinal = ?').run(new Date(Date.now() - 3_600_000).toISOString());
    assert.equal(verificarSemSinal(ctx).length, 0);
  });

  it('em 2x o prazo de sem sinal cai pela metade', () => {
    const ctx = criarContexto({ semSinalSegundos: 45 });
    const agora = Date.now();
    continuar(ctx, agora);
    definirVelocidade(ctx, 2, agora);
    ctx.db.prepare('UPDATE dispositivos SET ultimo_sinal = ?').run(new Date(agora).toISOString());
    // um dispositivo calado há 30 s: fora do prazo em 2x (22,5 s), dentro em 1x
    ctx.db
      .prepare('UPDATE dispositivos SET ultimo_sinal = ? WHERE id = (SELECT MIN(id) FROM dispositivos)')
      .run(new Date(agora - 30_000).toISOString());
    assert.equal(verificarSemSinal(ctx, agora).length, 1);
  });

  it('continuar desloca o último sinal pelo tempo pausado', () => {
    const ctx = criarContexto();
    continuar(ctx, 1_000_000);
    pausar(ctx, 2_000_000);
    ctx.db.prepare('UPDATE dispositivos SET ultimo_sinal = ?').run(new Date(1_990_000).toISOString());
    continuar(ctx, 2_060_000); // 60 s pausado
    const { ultimo_sinal } = ctx.db.prepare('SELECT ultimo_sinal FROM dispositivos LIMIT 1').get() as { ultimo_sinal: string };
    assert.equal(Date.parse(ultimo_sinal), 2_050_000);
  });

  it('quem reportou durante a pausa não vai para o futuro e a leitura seguinte não é atrasada', () => {
    const ctx = criarContexto();
    continuar(ctx, 1_000_000);
    pausar(ctx, 2_000_000);
    ctx.db.prepare('UPDATE dispositivos SET ultimo_sinal = ?').run(new Date(2_055_000).toISOString());
    continuar(ctx, 2_060_000);
    const { id, ultimo_sinal } = ctx.db.prepare('SELECT id, ultimo_sinal FROM dispositivos LIMIT 1').get() as { id: string; ultimo_sinal: string };
    assert.equal(Date.parse(ultimo_sinal), 2_060_000);
    const r = processarLeitura(ctx, id, { lat: -23.4, lng: -51.9, precisao: 5, bateria: 90, registradoEm: new Date(2_061_000).toISOString() });
    assert.equal(r.atrasada, false);
  });
});
