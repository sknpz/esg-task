import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avancar, criarFrota, gerarLitros, indicesDasParadas, montarEncontradas, passoDoRoteiro, simplificarTrajeto } from '../src/furgoes.ts';
import { distanciaM, type Ponto } from '../src/percurso.ts';

/** Sorteio previsível (LCG) para os testes estatísticos. */
function sorteio(semente = 42) {
  let s = semente;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

test('gerarLitros fica entre 0 e a capacidade e perto do esperado na maioria das vezes', () => {
  const rnd = sorteio();
  const n = 2400;
  let perto = 0;
  let bemAbaixo = 0;
  for (let i = 0; i < n; i++) {
    const l = gerarLitros(40, 50, rnd);
    assert.ok(Number.isInteger(l) && l >= 0 && l <= 50, `fora da faixa: ${l}`);
    if (l >= 34 && l <= 46) perto++;
    if (l < 16) bemAbaixo++;
  }
  // ~11/12 em torno do esperado (±15%) e ~1/12 abaixo de 40% dele (para a RN18 aparecer).
  assert.ok(perto / n > 0.85, `perto: ${perto}`);
  assert.ok(bemAbaixo / n > 0.05 && bemAbaixo / n < 0.12, `bem abaixo: ${bemAbaixo}`);
  // Esperado acima da capacidade: limitado a ela.
  for (let i = 0; i < 100; i++) assert.ok(gerarLitros(70, 50, rnd) <= 50);
});

test('gerarLitros sem histórico usa 70% da capacidade', () => {
  assert.equal(gerarLitros(null, 200, () => 0.5), 140);
  const rnd = sorteio(7);
  for (let i = 0; i < 500; i++) {
    const l = gerarLitros(null, 200, rnd);
    assert.ok(Number.isInteger(l) && l >= 119 && l <= 161, `fora de 70% ± 15%: ${l}`);
  }
});

test('passoDoRoteiro: rota longa termina no tempo alvo; curta usa o passo base', () => {
  const tempo = { duracaoS: 90, pausaMs: 1000, tickMs: 250 };
  // 10 paradas: 90 s − 10 s de pausas = 80 s = 320 ticks.
  assert.equal(passoDoRoteiro(160_000, 25, 10, tempo), 500);
  assert.equal(passoDoRoteiro(1_000, 25, 10, tempo), 25);
  // Sem paradas, o alvo inteiro.
  assert.equal(passoDoRoteiro(90_000, 25, 0, tempo), 250);
  // Pausas que comem o tempo todo: ao menos 1 tick.
  assert.equal(passoDoRoteiro(5_000, 25, 200, tempo), 5_000);
});

test('indicesDasParadas acha o ponto mais próximo de cada parada, em ordem', () => {
  // Vai para o leste por 0..10 e volta pelo mesmo caminho: cada parada é achada na ida, não na volta.
  const ida: Ponto[] = Array.from({ length: 11 }, (_, i) => ({ lat: 0, lng: i * 0.001 }));
  const rota = [...ida, ...ida.slice(0, -1).reverse()];
  const paradas = [
    { lat: 0.0001, lng: 0.0031 },
    { lat: -0.0001, lng: 0.0072 },
    { lat: 0, lng: 0.01 },
  ];
  assert.deepEqual(indicesDasParadas(rota, paradas), [3, 7, 10]);
  // Duas paradas no mesmo lugar: o mesmo índice, nunca para trás.
  assert.deepEqual(indicesDasParadas(rota, [paradas[1], paradas[1], paradas[0]]), [7, 7, 17]);
});

test('simplificarTrajeto mantém as pontas, os pontos das paradas e o limite', () => {
  const pontos: Ponto[] = Array.from({ length: 10_001 }, (_, i) => ({ lat: -23.6 - i * 1e-5, lng: -52.6 + i * 1.3e-5 }));
  const fixos = [1234, 5001, 9876];
  const s = simplificarTrajeto(pontos, fixos, 2000);
  assert.ok(s.length <= 2000);
  assert.deepEqual(s[0], [pontos[0].lat, pontos[0].lng].map((v) => Math.round(v * 1e6) / 1e6));
  const ultimo = pontos[pontos.length - 1];
  assert.deepEqual(s[s.length - 1], [ultimo.lat, ultimo.lng].map((v) => Math.round(v * 1e6) / 1e6));
  for (const i of fixos) {
    const p = [pontos[i].lat, pontos[i].lng].map((v) => Math.round(v * 1e6) / 1e6);
    assert.ok(s.some((q) => q[0] === p[0] && q[1] === p[1]), `faltou o ponto ${i}`);
  }
  // Cabe no limite de 64 kB do corpo com folga.
  assert.ok(JSON.stringify({ pontos: s, distanciaM: 123_456 }).length < 60_000);
  // Curto: vai inteiro.
  assert.equal(simplificarTrajeto(pontos.slice(0, 50), [10], 2000).length, 50);
});

test('avancar anda pelo caminho e para no limite (a parada), sem passar dele', () => {
  const pontos: Ponto[] = Array.from({ length: 5 }, (_, i) => ({ lat: 0, lng: i * 0.001 })); // ~111 m entre pontos
  const meio = avancar(pontos, pontos[0], 1, 50, 4);
  assert.equal(meio.chegou, false);
  assert.equal(meio.proximo, 1);
  assert.ok(Math.abs(meio.posicao.lng - 0.00045) < 1e-6);
  // Passo grande, limite no ponto 2: para nele, mesmo sobrando passo.
  const parada = avancar(pontos, pontos[0], 1, 10_000, 2);
  assert.deepEqual([parada.chegou, parada.proximo, parada.posicao], [true, 3, pontos[2]]);
});

test('montarEncontradas leva as procuradas que estão lá, com a capacidade de cada uma pelo código', () => {
  const parada = {
    litrosEsperados: null,
    procuradas: [
      { codigo: 'BO-0001', capacidadeL: 50 },
      { codigo: 'BO-0002', capacidadeL: 200 },
    ],
  };
  const meio = () => 0.5; // sem variação: 70% da capacidade
  assert.deepEqual(montarEncontradas(parada, (c) => c === 'BO-0002', meio), [{ codigo: 'BO-0002', litros: 140 }]);
  assert.deepEqual(montarEncontradas(parada, () => true, meio), [
    { codigo: 'BO-0001', litros: 35 },
    { codigo: 'BO-0002', litros: 140 },
  ]);
  assert.deepEqual(montarEncontradas(parada, () => false, meio), []);
});

// ---------- frota (com fetch falso) ----------

type Chamada = { url: string; headers: Record<string, string> };

/** Frota de um roteiro com uma parada a ~1 km a leste do pátio; OSRM e POSTs são falsos. */
async function frotaComFetchFalso(cabecalhos: () => Record<string, string>, segurarOsrm?: Promise<void>) {
  const patio = { lat: -23.66, lng: -52.6 };
  const parada = { lat: -23.66, lng: -52.59 };
  const chamadas: Chamada[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    chamadas.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> });
    if (u.includes('/route/v1/')) {
      await segurarOsrm;
      const coordinates = [patio, parada, patio].map((p) => [p.lng, p.lat]);
      return new Response(JSON.stringify({ routes: [{ distance: 2000, geometry: { coordinates } }] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const frota = criarFrota({
    api: 'http://api',
    token: 't',
    roteador: 'http://osrm',
    patio,
    tempo: { duracaoS: 100_000, pausaMs: 1000, tickMs: 250 },
    passoBaseM: 25,
    passoRealM: 5,
    esperaEntreTentativasMs: 2000,
    estaNoCliente: () => true,
    cabecalhos,
  });
  const roteiro = {
    id: 1,
    numero: 1,
    bombonas: [],
    paradas: [
      { id: 10, ordem: 1, status: 'PENDENTE' as const, clienteId: 1, nome: 'C', ...parada, litrosEsperados: null, procuradas: [] },
    ],
  };
  frota.ciclo([roteiro], false, 1, 'DEMO'); // começa a planejar
  await new Promise((ok) => setTimeout(ok, 20));
  return { frota, roteiro, chamadas, restaurar: () => (globalThis.fetch = original) };
}

test('em 2x o furgão anda o dobro por ciclo', async () => {
  const a = await frotaComFetchFalso(() => ({}));
  const b = await frotaComFetchFalso(() => ({}));
  try {
    const inicio = a.frota.posicao(1)!.posicao;
    await Promise.all(a.frota.ciclo([a.roteiro], false, 1, 'DEMO'));
    await Promise.all(b.frota.ciclo([b.roteiro], false, 2, 'DEMO'));
    const d1 = distanciaM(inicio, a.frota.posicao(1)!.posicao);
    const d2 = distanciaM(inicio, b.frota.posicao(1)!.posicao);
    assert.ok(d1 > 20, `d1: ${d1}`);
    assert.ok(Math.abs(d2 - 2 * d1) < 0.5, `d1: ${d1}, d2: ${d2}`);
  } finally {
    b.restaurar();
    a.restaurar();
  }
});

test('todo POST da frota leva os cabeçalhos', async () => {
  const f = await frotaComFetchFalso(() => ({ 'X-Rodada': '7' }));
  try {
    await Promise.all(f.frota.ciclo([f.roteiro], false, 1, 'DEMO'));
    const posts = f.chamadas.filter((c) => c.url.includes('/roteiros/'));
    assert.ok(posts.some((c) => c.url.endsWith('/posicao')), 'sem POST de posição');
    assert.ok(posts.some((c) => c.url.endsWith('/trajeto')), 'sem POST de trajeto');
    for (const c of posts) assert.equal(c.headers['X-Rodada'], '7', c.url);
  } finally {
    f.restaurar();
  }
});

test('em tempo real o furgão anda o passo real; em demonstração, o passo do roteiro', async () => {
  // Rota de ~2 km com duração alvo enorme: o passo de demonstração é o base (25 m); o real é 5 m.
  const a = await frotaComFetchFalso(() => ({}));
  const b = await frotaComFetchFalso(() => ({}));
  try {
    const inicio = a.frota.posicao(1)!.posicao;
    await Promise.all(a.frota.ciclo([a.roteiro], false, 1, 'REAL'));
    await Promise.all(b.frota.ciclo([b.roteiro], false, 1, 'DEMO'));
    const real = distanciaM(inicio, a.frota.posicao(1)!.posicao);
    const demo = distanciaM(inicio, b.frota.posicao(1)!.posicao);
    assert.ok(Math.abs(real - 5) < 0.5, `real: ${real}`);
    assert.ok(Math.abs(demo - 25) < 0.5, `demo: ${demo}`);
  } finally {
    b.restaurar();
    a.restaurar();
  }
});

test('trocar o modo no meio da rota continua de onde estava, no ritmo novo', async () => {
  const f = await frotaComFetchFalso(() => ({}));
  try {
    const inicio = f.frota.posicao(1)!.posicao;
    await Promise.all(f.frota.ciclo([f.roteiro], false, 1, 'DEMO'));
    const meio = f.frota.posicao(1)!.posicao;
    await Promise.all(f.frota.ciclo([f.roteiro], false, 1, 'REAL'));
    const total = distanciaM(inicio, f.frota.posicao(1)!.posicao);
    const ultimo = distanciaM(meio, f.frota.posicao(1)!.posicao);
    assert.ok(Math.abs(total - 30) < 0.5, `total: ${total}`);
    assert.ok(Math.abs(ultimo - 5) < 0.5, `último: ${ultimo}`);
  } finally {
    f.restaurar();
  }
});

test('trocar o modo antes de a rota ficar pronta não quebra; o furgão sai no ritmo do modo atual', async () => {
  let soltar!: () => void;
  const segurar = new Promise<void>((ok) => (soltar = ok));
  const f = await frotaComFetchFalso(() => ({}), segurar);
  try {
    const inicio = f.frota.posicao(1)!.posicao;
    await Promise.all(f.frota.ciclo([f.roteiro], false, 1, 'REAL'));
    await Promise.all(f.frota.ciclo([f.roteiro], false, 1, 'DEMO'));
    assert.equal(distanciaM(inicio, f.frota.posicao(1)!.posicao), 0);
    soltar();
    await new Promise((ok) => setTimeout(ok, 20));
    await Promise.all(f.frota.ciclo([f.roteiro], false, 1, 'REAL'));
    const andou = distanciaM(inicio, f.frota.posicao(1)!.posicao);
    assert.ok(Math.abs(andou - 5) < 0.5, `andou: ${andou}`);
  } finally {
    f.restaurar();
  }
});
