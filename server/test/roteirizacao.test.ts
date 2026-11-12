import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { comprimentoCircuitoM, dividirEmRoteiros, ordenarParadas, type ParadaPlano } from '../src/roteirizacao.ts';

const P = { lat: -23.71544, lng: -52.65906 }; // pátio, Cianorte

let proximoId = 1;
const parada = (dLat: number, dLng: number, demanda: number): ParadaPlano => ({
  clienteId: proximoId++,
  lat: P.lat + dLat,
  lng: P.lng + dLng,
  demanda,
});
const soma = (ps: ParadaPlano[]) => ps.reduce((s, p) => s + p.demanda, 0);

/** n paradas espalhadas em círculo ao redor do pátio (~20 a 40 km). */
function vinteParadasAoRedor(): ParadaPlano[] {
  return Array.from({ length: 20 }, (_, i) => {
    const ang = (i / 20) * 2 * Math.PI;
    const raio = 0.2 + (i % 3) * 0.1;
    return parada(raio * Math.sin(ang), raio * Math.cos(ang), 1 + (i % 3));
  });
}

/** n paradas em linha para o leste, a distâncias crescentes. */
function paradas(n: number, demanda: number): ParadaPlano[] {
  return Array.from({ length: n }, (_, i) => parada(0.01 * (i % 2), 0.05 * (i + 1), demanda));
}

describe('roteirização', () => {
  it('nenhum roteiro passa da capacidade e nenhuma parada é dividida', () => {
    const entrada = vinteParadasAoRedor();
    const { roteiros, naoAtendidas } = dividirEmRoteiros(P, entrada, 8, 4);
    for (const r of roteiros) assert.ok(soma(r) <= 8);
    const ids = [...roteiros.flat(), ...naoAtendidas].map((p) => p.clienteId).sort((a, b) => a - b);
    assert.deepEqual(ids, entrada.map((p) => p.clienteId).sort((a, b) => a - b));
  });

  it('separa por região: paradas ao norte e ao sul não dividem furgão', () => {
    const norte = [0, 1, 2, 3].map((i) => parada(0.3, -0.03 + i * 0.02, 2));
    const sul = [0, 1, 2, 3].map((i) => parada(-0.3, -0.03 + i * 0.02, 2));
    const misturado = [norte[0], sul[0], norte[1], sul[1], norte[2], sul[2], norte[3], sul[3]];
    const { roteiros, naoAtendidas } = dividirEmRoteiros(P, misturado, 8, 4);
    assert.equal(naoAtendidas.length, 0);
    assert.equal(roteiros.length, 2);
    for (const r of roteiros) {
      const lados = new Set(r.map((p) => p.lat > P.lat));
      assert.equal(lados.size, 1);
      assert.equal(r.length, 4);
    }
  });

  it('o que não cabe na frota vira não atendida', () => {
    const { roteiros, naoAtendidas } = dividirEmRoteiros(P, paradas(10, 2), 4, 2);
    assert.equal(roteiros.length, 2);
    assert.equal(soma(naoAtendidas), 12);
    for (const r of roteiros) assert.ok(soma(r) <= 4);
  });

  it('parada maior que a capacidade vira não atendida', () => {
    const grande = parada(0.1, 0.1, 9);
    const pequena = parada(0.1, -0.1, 3);
    const { roteiros, naoAtendidas } = dividirEmRoteiros(P, [grande, pequena], 8, 4);
    assert.deepEqual(naoAtendidas, [grande]);
    assert.deepEqual(roteiros, [[pequena]]);
  });

  it('dia sem paradas não gera roteiro', () => {
    assert.deepEqual(dividirEmRoteiros(P, [], 8, 4), { roteiros: [], naoAtendidas: [] });
  });

  it('mantém os campos extras das paradas e é determinístico', () => {
    const entrada = vinteParadasAoRedor().map((p) => ({ ...p, contratoId: p.clienteId * 10 }));
    const a = dividirEmRoteiros(P, entrada, 8, 4);
    const b = dividirEmRoteiros(P, [...entrada].reverse(), 8, 4);
    assert.deepEqual(a, b);
    assert.ok(a.roteiros.flat().every((p) => p.contratoId === p.clienteId * 10));
  });

  it('ordenação não é pior que a ordem de entrada e começa pela mais próxima do pátio', () => {
    const linha = paradas(6, 1);
    const embaralhada = [linha[3], linha[0], linha[5], linha[2], linha[4], linha[1]];
    const ordenada = ordenarParadas(P, embaralhada);
    assert.equal(ordenada.length, 6);
    assert.ok(comprimentoCircuitoM(P, ordenada) <= comprimentoCircuitoM(P, embaralhada));
    assert.equal(ordenada[0].clienteId, linha[0].clienteId);
    const cruzada = vinteParadasAoRedor();
    assert.ok(comprimentoCircuitoM(P, ordenarParadas(P, cruzada)) <= comprimentoCircuitoM(P, cruzada));
  });

  it('circuito de zero ou uma parada', () => {
    assert.equal(comprimentoCircuitoM(P, []), 0);
    assert.deepEqual(ordenarParadas(P, []), []);
    const uma = parada(0.1, 0, 1);
    assert.deepEqual(ordenarParadas(P, [uma]), [uma]);
    assert.ok(comprimentoCircuitoM(P, [uma]) > 20_000);
  });
});
