import type { Ponto } from './api.ts';

/** Mesmo serviço de rotas (OSRM) que o simulador usa para o caminhão andar pelas ruas. */
const ROTEADOR = import.meta.env.VITE_ROTEADOR_URL ?? 'https://router.project-osrm.org';

/** Caminho pelas ruas de `de` até `para`, ou null se o serviço não responder. */
export async function buscarRota(de: Ponto, para: Ponto): Promise<Ponto[] | null> {
  try {
    const url = `${ROTEADOR}/route/v1/driving/${de.lng},${de.lat};${para.lng},${para.lat}?overview=full&geometries=geojson`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const corpo = (await r.json()) as { routes?: { geometry: { coordinates: [number, number][] } }[] };
    const coordenadas = corpo.routes?.[0]?.geometry.coordinates;
    return coordenadas?.length ? [...coordenadas.map(([lng, lat]) => ({ lat, lng })), para] : null;
  } catch {
    return null;
  }
}

const M_POR_GRAU_LAT = 111_195;

/** Distância aproximada em metros (suficiente para trechos de rota). */
export function metrosEntre(a: Ponto, b: Ponto) {
  const dy = (b.lat - a.lat) * M_POR_GRAU_LAT;
  const dx = (b.lng - a.lng) * M_POR_GRAU_LAT * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

export function comprimento(caminho: Ponto[]) {
  let total = 0;
  for (let i = 1; i < caminho.length; i++) total += metrosEntre(caminho[i - 1], caminho[i]);
  return total;
}

/** O trecho da rota que ainda falta a partir de `posicao` (corta no ponto da rota mais próximo). */
export function trechoRestante(rota: Ponto[], posicao: Ponto): Ponto[] {
  let maisProximo = 0;
  let menor = Infinity;
  rota.forEach((p, i) => {
    const d = (p.lat - posicao.lat) ** 2 + (p.lng - posicao.lng) ** 2;
    if (d < menor) {
      menor = d;
      maisProximo = i;
    }
  });
  return [posicao, ...rota.slice(maisProximo + 1)];
}
