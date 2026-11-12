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

  it('lista as 107 bombonas do seed com posição e local esperado', async () => {
    const bombonas = await (await fetch(`${api.url}/bombonas`)).json();
    assert.equal(bombonas.length, 107);
    const emCliente = bombonas.filter((b: any) => b.status === 'EM_CLIENTE');
    assert.equal(emCliente.length, 64);
    for (const b of emCliente) {
      assert.ok(b.localEsperado, b.codigo);
      assert.ok(b.distanciaM < 150, `${b.codigo} está a ${b.distanciaM} m`);
    }
    // Nenhuma nasce em rota sem furgão (BO-0023 e BO-0024 começam no pátio).
    assert.equal(bombonas.filter((b: any) => b.status === 'EM_ROTA').length, 0);
    assert.deepEqual(
      bombonas.filter((b: any) => ['BO-0023', 'BO-0024'].includes(b.codigo)).map((b: any) => b.status),
      ['PATIO', 'PATIO'],
    );
  });

  it('filtra por status', async () => {
    const patio = await (await fetch(`${api.url}/bombonas?status=PATIO`)).json();
    assert.equal(patio.length, 43);
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
    const ins = ctx.db.prepare("INSERT INTO leituras (bombona_id, dispositivo_id, lat, lng, bateria, registrado_em) VALUES (?, ?, -23.6, ?, 80, ?)");
    for (let i = 0; i < 205; i++) ins.run(id, dispositivo_id, -52.6 + i * 0.0001, new Date(Date.now() - (205 - i) * 1000).toISOString());
    const trilha = async (q: string) => (await (await fetch(`${api.url}/bombonas/BO-0001/trilha${q}`)).json()).length;
    assert.equal(await trilha('?limite=3'), 3);
    assert.equal(await trilha('?limite=-1'), 200);
    assert.equal(await trilha('?limite=abc'), 200);
  });

  it('não repete na trilha as leituras da bombona parada: o tempo parada não apaga o caminho', async () => {
    const { id, dispositivo_id } = ctx.db.prepare("SELECT id, dispositivo_id FROM bombonas WHERE codigo = 'BO-0002'").get() as {
      id: number;
      dispositivo_id: string;
    };
    const ins = ctx.db.prepare("INSERT INTO leituras (bombona_id, dispositivo_id, lat, lng, bateria, registrado_em) VALUES (?, ?, -23.7, ?, 80, ?)");
    const quando = (i: number) => new Date(Date.now() - (100 - i) * 1000).toISOString();
    for (let i = 0; i < 5; i++) ins.run(id, dispositivo_id, -52.7 + i * 0.001, quando(i));
    for (let i = 5; i < 50; i++) ins.run(id, dispositivo_id, -52.7 + 4 * 0.001, quando(i));
    const trilha = await (await fetch(`${api.url}/bombonas/BO-0002/trilha?limite=5`)).json();
    assert.deepEqual(
      trilha.map((p: { lng: number }) => p.lng),
      [0, 1, 2, 3, 4].map((i) => -52.7 + i * 0.001),
    );
  });

  it('a trilha mostra só o último percurso: parada encerra um e a próxima saída começa outro', async () => {
    const { id, dispositivo_id } = ctx.db.prepare("SELECT id, dispositivo_id FROM bombonas WHERE codigo = 'BO-0003'").get() as {
      id: number;
      dispositivo_id: string;
    };
    const ins = ctx.db.prepare("INSERT INTO leituras (bombona_id, dispositivo_id, lat, lng, bateria, registrado_em) VALUES (?, ?, -23.8, ?, 80, ?)");
    let i = 0;
    const leituras = (...lngs: number[]) => lngs.forEach((lng) => ins.run(id, dispositivo_id, lng, new Date(Date.now() - 100_000 + i++ * 1000).toISOString()));
    const lngs = async () => ((await (await fetch(`${api.url}/bombonas/BO-0003/trilha`)).json()) as { lng: number }[]).map((p) => p.lng);

    leituras(-52.1, -52.2, -52.3);
    assert.deepEqual(await lngs(), [-52.1, -52.2, -52.3], 'primeiro percurso, em andamento');

    leituras(-52.3, -52.3);
    assert.deepEqual(await lngs(), [-52.1, -52.2, -52.3], 'parada: o percurso concluído continua visível');

    leituras(-52.4);
    assert.deepEqual(await lngs(), [-52.3, -52.4], 'nova saída: o percurso anterior some');

    leituras(-52.5, -52.5, -52.6);
    assert.deepEqual(await lngs(), [-52.5, -52.6], 'outra parada e outra saída');
  });

  it('classifica o risco dos clientes pelo histórico (RN14)', async () => {
    const clientes = await (await fetch(`${api.url}/clientes`)).json();
    const pastelaria = clientes.find((c: any) => c.nome === 'Pastelaria do Japonês');
    assert.equal(pastelaria.incidentes, 3);
    assert.equal(pastelaria.risco, 'ALTO');
    assert.equal(clientes.find((c: any) => c.nome === 'Lanchonete Estação').risco, 'MEDIO');
    assert.equal(clientes.find((c: any) => c.nome === 'Hotel Colonial').risco, 'BAIXO');
  });

  it('espalha os clientes pelo raio de atendimento', () => {
    const clientes = ctx.db.prepare('SELECT cidade, lat, lng FROM clientes').all() as any[];
    assert.ok(clientes.length >= 25);
    assert.ok(new Set(clientes.map((c) => c.cidade)).size >= 12);
    for (const c of clientes) assert.ok(distanciaM(ctx.config.patio, c) <= 250_000);
    assert.ok(clientes.some((c) => distanciaM(ctx.config.patio, c) >= 100_000));
  });

  it('o pátio fica no local real da Bio Óleo', () => {
    assert.equal(ctx.config.patio.lat, -23.71544);
    assert.equal(ctx.config.patio.lng, -52.65906);
  });

  it('cada cliente tem de 3 a 6 coletas com litros dentro da capacidade', () => {
    // O cliente 50 não tem bombona (cliente para criar contrato ao vivo), logo não tem coletas.
    const clientes = ctx.db.prepare('SELECT id FROM clientes WHERE id <= 49').all() as any[];
    const q = ctx.db.prepare(
      `SELECT m.litros, b.capacidade_l FROM movimentacoes m JOIN bombonas b ON b.id = m.bombona_id
       WHERE m.cliente_id = ? AND m.tipo = 'COLETA' AND m.litros IS NOT NULL`);
    for (const c of clientes) {
      const coletas = q.all(c.id) as any[];
      assert.ok(coletas.length >= 3 && coletas.length <= 6, `cliente ${c.id}: ${coletas.length} coletas`);
      const media = coletas.reduce((t, x) => t + x.litros, 0) / coletas.length;
      for (const x of coletas) {
        assert.ok(x.litros > 0 && x.litros <= x.capacidade_l, `cliente ${c.id}: ${x.litros} L`);
        assert.ok(x.litros >= 0.5 * media, `cliente ${c.id}: ${x.litros} L abaixo de 50% da média`);
      }
    }
  });

  it('resume os indicadores', async () => {
    const ind = await (await fetch(`${api.url}/indicadores`)).json();
    assert.equal(ind.total, 107);
    // Ninguém nasce em rota: na versão com roteiros, bombona só viaja dentro do furgão.
    assert.deepEqual(ind.porStatus, { PATIO: 43, EM_ROTA: 0, EM_CLIENTE: 64, EXTRAVIADA: 0 });
    assert.equal(ind.alertasAbertos, 0);
  });
});
