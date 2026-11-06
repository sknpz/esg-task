import { distanciaM, type Ponto } from './geo.ts';

export type ParadaPlano = { clienteId: number; lat: number; lng: number; demanda: number };

/** Comprimento (m, linha reta) do circuito pátio → paradas na ordem dada → pátio. */
export function comprimentoCircuitoM(patio: Ponto, paradas: ParadaPlano[]): number {
  if (paradas.length === 0) return 0;
  let total = distanciaM(patio, paradas[0]);
  for (let i = 1; i < paradas.length; i++) total += distanciaM(paradas[i - 1], paradas[i]);
  return total + distanciaM(paradas[paradas.length - 1], patio);
}

/** Vizinho mais próximo a partir do pátio, depois 2-opt até não melhorar. Não altera a entrada. */
export function ordenarParadas<T extends ParadaPlano>(patio: Ponto, paradas: T[]): T[] {
  const restantes = [...paradas].sort((a, b) => a.clienteId - b.clienteId);
  const rota: T[] = [];
  let atual: Ponto = patio;
  while (restantes.length > 0) {
    let melhor = 0;
    let melhorD = Infinity;
    restantes.forEach((p, i) => {
      const d = distanciaM(atual, p);
      if (d < melhorD) {
        melhorD = d;
        melhor = i;
      }
    });
    const [prox] = restantes.splice(melhor, 1);
    rota.push(prox);
    atual = prox;
  }

  const ponto = (i: number): Ponto => (i < 0 || i >= rota.length ? patio : rota[i]);
  let melhorou = true;
  while (melhorou) {
    melhorou = false;
    for (let i = 0; i < rota.length - 1; i++) {
      for (let j = i + 1; j < rota.length; j++) {
        const antes = distanciaM(ponto(i - 1), ponto(i)) + distanciaM(ponto(j), ponto(j + 1));
        const depois = distanciaM(ponto(i - 1), ponto(j)) + distanciaM(ponto(i), ponto(j + 1));
        if (depois < antes - 1e-6) {
          const trecho = rota.slice(i, j + 1).reverse();
          rota.splice(i, trecho.length, ...trecho);
          melhorou = true;
        }
      }
    }
  }
  return rota;
}

/**
 * Divide as paradas do dia entre os furgões (RN23): varredura angular a partir do pátio, começando depois do
 * maior vão entre paradas vizinhas; enche um roteiro até a próxima não caber e abre outro. O que passar da
 * frota máxima, ou que sozinho exceda a capacidade, é não atendido. Cada roteiro já sai ordenado.
 */
export function dividirEmRoteiros<T extends ParadaPlano>(
  patio: Ponto,
  paradas: T[],
  capacidade: number,
  frotaMaxima: number,
): { roteiros: T[][]; naoAtendidas: T[] } {
  const naoAtendidas: T[] = [];
  const candidatas: T[] = [];
  for (const p of paradas) (p.demanda > capacidade ? naoAtendidas : candidatas).push(p);

  const cosLat = Math.cos((patio.lat * Math.PI) / 180);
  const comAngulo = candidatas
    .map((p) => ({ p, ang: Math.atan2(p.lat - patio.lat, (p.lng - patio.lng) * cosLat), d: distanciaM(patio, p) }))
    .sort((a, b) => a.ang - b.ang || a.d - b.d || a.p.clienteId - b.p.clienteId);

  // Começa logo depois do maior vão angular (inclui o vão que dá a volta de -π a π).
  let inicio = 0;
  let maiorVao = -1;
  const n = comAngulo.length;
  for (let i = 0; i < n; i++) {
    const seguinte = comAngulo[(i + 1) % n];
    const vao = (seguinte.ang - comAngulo[i].ang + 2 * Math.PI) % (2 * Math.PI) || (n === 1 ? 2 * Math.PI : 0);
    if (vao > maiorVao) {
      maiorVao = vao;
      inicio = (i + 1) % n;
    }
  }
  const varredura = [...comAngulo.slice(inicio), ...comAngulo.slice(0, inicio)].map((x) => x.p);

  const grupos: T[][] = [];
  let atual: T[] = [];
  let carga = 0;
  for (const p of varredura) {
    if (atual.length > 0 && carga + p.demanda > capacidade) {
      grupos.push(atual);
      atual = [];
      carga = 0;
    }
    if (grupos.length >= frotaMaxima) {
      naoAtendidas.push(p);
      continue;
    }
    atual.push(p);
    carga += p.demanda;
  }
  if (atual.length > 0) grupos.push(atual);

  return { roteiros: grupos.map((g) => ordenarParadas(patio, g)), naoAtendidas };
}
