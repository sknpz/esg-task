import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { distanciaM, dentroDaCerca } from '../src/geo.ts';
import { criarContexto, subirApi } from './apoio.ts';

describe('geo', () => {
  it('calcula a distância entre Cianorte e Tapejara (~28 km)', () => {
    const d = distanciaM({ lat: -23.6599, lng: -52.6054 }, { lat: -23.7317, lng: -52.8736 });
    assert.ok(d > 27_000 && d < 29_000, `distância ${d}`);
  });

  it('considera a precisão do GPS na cerca (RN06)', () => {
    const centro = { lat: -23.66, lng: -52.6 };
    const a180m = { lat: -23.66 + 180 / 111_195, lng: -52.6 };
    assert.equal(dentroDaCerca(a180m, centro, 150), false);
    assert.equal(dentroDaCerca(a180m, centro, 150, 40), true);
  });
});

describe('API de consulta', () => {
  const ctx = criarContexto();
  let api: Awaited<ReturnType<typeof subirApi>>;
  before(async () => (api = await subirApi(ctx)));
  after(() => api.fechar());

  it('lista as 24 bombonas do seed com posição e local esperado', async () => {
    const bombonas = await (await fetch(`${api.url}/bombonas`)).json();
    assert.equal(bombonas.length, 24);
    const emCliente = bombonas.filter((b: any) => b.status === 'EM_CLIENTE');
    assert.equal(emCliente.length, 17);
    for (const b of emCliente) {
      assert.ok(b.localEsperado, b.codigo);
      assert.ok(b.distanciaM < 150, `${b.codigo} está a ${b.distanciaM} m`);
    }
    const emRota = bombonas.filter((b: any) => b.status === 'EM_ROTA');
    assert.equal(emRota.length, 2);
    assert.ok(emRota.every((b: any) => b.localEsperado === null && b.destino));
  });

  it('filtra por status', async () => {
    const patio = await (await fetch(`${api.url}/bombonas?status=PATIO`)).json();
    assert.equal(patio.length, 5);
  });

  it('detalha uma bombona com histórico e devolve 404 para código inexistente', async () => {
    const detalhe = await (await fetch(`${api.url}/bombonas/bo-0001`)).json();
    assert.equal(detalhe.codigo, 'BO-0001');
    assert.ok(detalhe.movimentacoes.length >= 2);
    assert.equal((await fetch(`${api.url}/bombonas/BO-9999`)).status, 404);
  });

  it('limita a trilha e ignora limite negativo', async () => {
    const { id, dispositivo_id } = ctx.db.prepare("SELECT id, dispositivo_id FROM bombonas WHERE codigo = 'BO-0001'").get() as {
      id: number;
      dispositivo_id: string;
    };
    const ins = ctx.db.prepare(
      "INSERT INTO leituras (bombona_id, dispositivo_id, lat, lng, bateria, registrado_em) VALUES (?, ?, -23.6, -52.6, 80, ?)",
    );
    for (let i = 0; i < 205; i++) ins.run(id, dispositivo_id, new Date(Date.now() - (205 - i) * 1000).toISOString());
    const trilha = async (q: string) => (await (await fetch(`${api.url}/bombonas/BO-0001/trilha${q}`)).json()).length;
    assert.equal(await trilha('?limite=3'), 3);
    assert.equal(await trilha('?limite=-1'), 200);
    assert.equal(await trilha('?limite=abc'), 200);
  });

  it('classifica o risco dos clientes pelo histórico (RN14)', async () => {
    const clientes = await (await fetch(`${api.url}/clientes`)).json();
    const pastelaria = clientes.find((c: any) => c.nome === 'Pastelaria do Japonês');
    assert.equal(pastelaria.incidentes, 3);
    assert.equal(pastelaria.risco, 'ALTO');
    assert.equal(clientes.find((c: any) => c.nome === 'Lanchonete Estação').risco, 'MEDIO');
    assert.equal(clientes.find((c: any) => c.nome === 'Hotel Colonial').risco, 'BAIXO');
  });

  it('resume os indicadores', async () => {
    const ind = await (await fetch(`${api.url}/indicadores`)).json();
    assert.equal(ind.total, 24);
    assert.deepEqual(ind.porStatus, { PATIO: 5, EM_ROTA: 2, EM_CLIENTE: 17, EXTRAVIADA: 0 });
    assert.equal(ind.alertasAbertos, 0);
  });
});
