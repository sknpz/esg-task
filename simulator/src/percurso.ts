/** Geometria de percursos do simulador (funções puras, testáveis sem rede). */

export type Ponto = { lat: number; lng: number };

export const M_POR_GRAU_LAT = 111_195;
export const mPorGrauLng = (lat: number) => M_POR_GRAU_LAT * Math.cos((lat * Math.PI) / 180);

export function distanciaM(a: Ponto, b: Ponto) {
  const dy = (b.lat - a.lat) * M_POR_GRAU_LAT;
  const dx = (b.lng - a.lng) * mPorGrauLng(a.lat);
  return Math.hypot(dx, dy);
}

/** Comprimento total, em metros, de um caminho que passa pelos pontos em ordem. */
export function comprimentoM(pontos: Ponto[]) {
  let total = 0;
  for (let i = 1; i < pontos.length; i++) total += distanciaM(pontos[i - 1], pontos[i]);
  return total;
}

/** Metros por tick: a velocidade base, ou mais rápido se a base estourar o limite de ticks da viagem. */
export function passoDaViagem(comprimentoM: number, passoBaseM: number, ticksMax: number) {
  return Math.max(passoBaseM, comprimentoM / ticksMax);
}
