import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { avancarOperacao, continuar, definirModo, definirVelocidade, estadoOperacao } from '../src/operacao.ts';
import { criarContexto, subirApi } from './apoio.ts';

const ctx = criarContexto();
let api: Awaited<ReturnType<typeof subirApi>>;
before(async () => (api = await subirApi(ctx)));
after(() => api.fechar());

const post = async (caminho: string, corpo: unknown = {}, headers: Record<string, string> = {}) => {
  const r = await fetch(`${api.url}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json() };
};
const get = async (caminho: string, headers: Record<string, string> = {}) => (await fetch(`${api.url}${caminho}`, { headers })).json();

const token = (codigo: string) =>
  (ctx.db.prepare('SELECT d.token FROM dispositivos d JOIN bombonas b ON b.dispositivo_id = d.id WHERE b.codigo = ?').get(codigo) as { token: string }).token;
const telemetria = (codigo: string, ponto: { lat: number; lng: number }) =>
  post('/telemetria', { ...ponto, bateria: 80 }, { Authorization: `Bearer ${token(codigo)}` });

describe('movimentações', () => {
  it('envia uma bombona do pátio para um cliente (RN03)', async () => {
    const { status, corpo } = await post('/bombonas/BO-0018/entrega', { clienteId: 6 });
    assert.equal(status, 200);
    assert.equal(corpo.status, 'EM_ROTA');
    assert.equal(corpo.destino.nome, 'Hotel Colonial');
    const detalhe = await get('/bombonas/BO-0018');
    assert.equal(detalhe.movimentacoes[0].tipo, 'SAIDA_PARA_ENTREGA');
  });

  it('recusa enviar bombona que não está no pátio e cliente inexistente', async () => {
    assert.equal((await post('/bombonas/BO-0001/entrega', { clienteId: 6 })).status, 409);
    assert.equal((await post('/bombonas/BO-0019/entrega', { clienteId: 999 })).status, 404);
    assert.equal((await post('/bombonas/BO-0019/entrega', {})).status, 400);
    assert.equal((await post('/bombonas/BO-9999/entrega', { clienteId: 1 })).status, 404);
  });

  it('coleta uma bombona em cliente e conclui o retorno ao chegar no pátio (RN05, RN04)', async () => {
    const { corpo } = await post('/bombonas/BO-0002/coleta', { litros: 40, observacao: 'Coleta semanal' });
    assert.equal(corpo.status, 'EM_ROTA');
    assert.equal(corpo.destino.nome, 'Pátio Bio Óleo');
    await telemetria('BO-0002', { lat: ctx.config.patio.lat, lng: ctx.config.patio.lng });
    const detalhe = await get('/bombonas/BO-0002');
    assert.equal(detalhe.status, 'PATIO');
    assert.deepEqual(
      detalhe.movimentacoes.slice(0, 2).map((m: any) => m.tipo),
      ['RETORNO_AO_PATIO', 'COLETA'],
    );
  });

  it('coleta normal exige litros inteiros entre 0 e a capacidade (RN17)', async () => {
    for (const litros of [undefined, '42', 42.5, -1, 51]) // BO-0001 é de 50 L
      assert.equal((await post('/bombonas/BO-0001/coleta', { litros })).status, 400);
    assert.equal((await get('/bombonas/BO-0001')).status, 'EM_CLIENTE'); // nada foi registrado
  });

  it('guarda os litros na movimentação de coleta', async () => {
    await post('/bombonas/BO-0004/coleta', { litros: 38 });
    const [mov] = (await get('/bombonas/BO-0004')).movimentacoes;
    assert.deepEqual([mov.tipo, mov.litros], ['COLETA', 38]);
  });

  it('recupera uma bombona extraviada e fecha os alertas como operador', async () => {
    const casa = (await get('/bombonas/BO-0003')).localEsperado;
    const longe = { lat: casa.lat + 0.03, lng: casa.lng };
    await telemetria('BO-0003', longe);
    await telemetria('BO-0003', longe);
    assert.equal((await get('/bombonas/BO-0003')).status, 'EXTRAVIADA');

    const { corpo } = await post('/bombonas/BO-0003/coleta', { observacao: 'Achada no ferro-velho' });
    assert.equal(corpo.status, 'EM_ROTA');
    const detalhe = await get('/bombonas/BO-0003');
    assert.equal(detalhe.movimentacoes[0].tipo, 'RECUPERACAO');
    assert.equal(detalhe.movimentacoes[0].litros, null);
    const daOcorrencia = detalhe.alertas.filter((a: any) => ['FORA_DA_AREA', 'EXTRAVIO'].includes(a.tipo) && a.resolucao === 'Achada no ferro-velho');
    assert.equal(daOcorrencia.length, 2);
    assert.ok(daOcorrencia.every((a: any) => a.resolvidoPor === 'OPERADOR'));
  });

  it('recusa coletar bombona que está no pátio', async () => {
    assert.equal((await post('/bombonas/BO-0020/coleta')).status, 409);
  });
});

describe('resolução manual de alertas (RN15)', () => {
  it('exige observação e não resolve duas vezes', async () => {
    const casa = (await get('/bombonas/BO-0007')).localEsperado;
    await post('/telemetria', { ...casa, bateria: 5 }, { Authorization: `Bearer ${token('BO-0007')}` });
    const alerta = (await get('/alertas?status=ABERTO')).find((a: any) => a.bombona === 'BO-0007' && a.tipo === 'BATERIA_BAIXA');
    assert.ok(alerta);

    assert.equal((await post(`/alertas/${alerta.id}/resolver`, { observacao: '' })).status, 400);
    const ok = await post(`/alertas/${alerta.id}/resolver`, { observacao: 'Bateria trocada na visita' });
    assert.equal(ok.status, 200);
    assert.equal(ok.corpo.resolvidoPor, 'OPERADOR');
    assert.equal((await post(`/alertas/${alerta.id}/resolver`, { observacao: 'de novo' })).status, 409);
    assert.equal((await post('/alertas/99999/resolver', { observacao: 'nada' })).status, 404);
  });

  it('reabre o alerta se continuar fora, sem contar novo incidente para o cliente (RN14)', async () => {
    const b = await get('/bombonas/BO-0011');
    const incidentes = async () => (await get('/clientes')).find((c: any) => c.id === b.cliente.id).incidentes;
    const antes = await incidentes();
    const fora = { lat: b.localEsperado.lat + 0.005, lng: b.localEsperado.lng };
    await telemetria('BO-0011', fora);
    await telemetria('BO-0011', fora);
    assert.equal(await incidentes(), antes + 1);

    const alerta = (await get('/alertas?status=ABERTO')).find((a: any) => a.bombona === 'BO-0011' && a.tipo === 'FORA_DA_AREA');
    await post(`/alertas/${alerta.id}/resolver`, { observacao: 'Conferindo com o cliente' });
    await telemetria('BO-0011', fora);
    const reaberto = (await get('/alertas?status=ABERTO')).find((a: any) => a.bombona === 'BO-0011' && a.tipo === 'FORA_DA_AREA');
    assert.ok(reaberto && reaberto.id !== alerta.id);
    assert.equal(await incidentes(), antes + 1);
  });
});

describe('canal de simulação (demo)', () => {
  const auth = { Authorization: `Bearer ${ctx.config.tokenSimulador}` };

  it('exige o token do simulador', async () => {
    assert.equal((await fetch(`${api.url}/simulacao/estado`)).status, 401);
  });

  it('entrega o estado dos dispositivos e consome cada comando uma vez', async () => {
    assert.equal((await post('/simulacao/comandos', { bombona: 'BO-0010', tipo: 'XYZ' })).status, 400);
    assert.equal((await post('/simulacao/comandos', { bombona: 'BO-0010', tipo: 'VENDA' })).status, 201);

    const estado = await get('/simulacao/estado', auth);
    assert.equal(estado.dispositivos.length, 107);
    const d = estado.dispositivos.find((x: any) => x.bombona === 'BO-0010');
    assert.equal(d.token, token('BO-0010'));
    assert.ok(d.alvo.nome);
    assert.deepEqual(estado.comandos.map((c: any) => [c.bombona, c.tipo]), [['BO-0010', 'VENDA']]);

    assert.deepEqual((await get('/simulacao/estado', auth)).comandos, []);
  });
});

describe('relógio da operação: pausa, velocidade, rodada', () => {
  it('banco novo nasce pausado, em 1x, rodada 1, dia 1', () => {
    const c = criarContexto();
    const e = estadoOperacao(c);
    assert.equal(e.pausado, true);
    assert.equal(e.velocidade, 1);
    assert.equal(e.rodada, 1);
    assert.equal(e.dia, 1);
    assert.equal(e.fase, 'MANHA');
  });

  it('banco novo nasce em tempo real', () => {
    assert.equal(estadoOperacao(criarContexto()).modo, 'REAL');
  });

  it('definirModo grava, emite operacao e não mexe em fase_desde', () => {
    const c = criarContexto();
    const antes = estadoOperacao(c).faseDesde;
    const vistos: Array<{ tipo: string }> = [];
    c.eventos.ouvir((e) => vistos.push(e));
    const e = definirModo(c, 'DEMO');
    assert.equal(e.modo, 'DEMO');
    assert.equal(estadoOperacao(c).modo, 'DEMO');
    assert.equal(e.faseDesde, antes);
    assert.ok(vistos.some((v) => v.tipo === 'operacao'));
  });

  it('POST /operacao/modo aceita REAL e DEMO e recusa o resto', async () => {
    const demo = await post('/operacao/modo', { modo: 'DEMO' });
    assert.equal(demo.status, 200);
    assert.equal(demo.corpo.modo, 'DEMO');
    assert.equal((await get('/simulacao/estado', { Authorization: `Bearer ${ctx.config.tokenSimulador}` })).operacao.modo, 'DEMO');
    assert.equal((await post('/operacao/modo', { modo: 'RAPIDO' })).status, 400);
    assert.equal((await post('/operacao/modo', {})).status, 400);
    assert.equal((await post('/operacao/modo', { modo: 'REAL' })).corpo.modo, 'REAL');
  });

  it('pausado na criação, a manhã não avança', () => {
    const c = criarContexto({ fasePausaS: 5 });
    const t0 = Date.parse(estadoOperacao(c).faseDesde);
    avancarOperacao(c, t0 + 60_000);
    assert.equal(estadoOperacao(c).fase, 'MANHA');
  });

  it('em 2x a manhã dura metade', () => {
    const c = criarContexto({ fasePausaS: 10 });
    continuar(c);
    definirVelocidade(c, 2);
    const t0 = Date.parse(estadoOperacao(c).faseDesde);
    assert.equal(estadoOperacao(c).faseDuracaoMs, 5000);
    avancarOperacao(c, t0 + 4900);
    assert.equal(estadoOperacao(c).fase, 'MANHA');
    avancarOperacao(c, t0 + 5100);
    assert.equal(estadoOperacao(c).fase, 'ROTAS');
  });

  it('trocar a velocidade no meio da fase mantém a fração decorrida', () => {
    const c = criarContexto({ fasePausaS: 10 });
    continuar(c, 1_000_000);
    c.db.prepare('UPDATE operacao SET fase_desde = ?').run(new Date(1_000_000).toISOString());
    definirVelocidade(c, 2, 1_004_000); // 40% de 10 s em 1x
    assert.equal(Date.parse(estadoOperacao(c).faseDesde), 1_002_000); // 40% de 5 s em 2x
  });

  it('POST /operacao/velocidade aceita 1 e 2 e recusa o resto', async () => {
    const dois = await post('/operacao/velocidade', { velocidade: 2 });
    assert.equal(dois.status, 200);
    assert.equal(dois.corpo.velocidade, 2);
    assert.equal((await get('/simulacao/estado', { Authorization: `Bearer ${ctx.config.tokenSimulador}` })).operacao.velocidade, 2);
    assert.equal((await post('/operacao/velocidade', { velocidade: 3 })).status, 400);
    const texto = await post('/operacao/velocidade', { velocidade: '2' });
    assert.equal(texto.status, 400);
    assert.ok(texto.corpo.erro);
  });
});
