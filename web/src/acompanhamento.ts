import type { Ponto, Roteiro } from './api.ts';

/**
 * Onde está o furgão acompanhado: a posição do roteiro `id` enquanto ele está na rua. Concluído, ainda no pátio, sem
 * posição ou fora da lista (reset, outro dia): null, e o acompanhamento desliga.
 */
export function posicaoDoAcompanhado(roteiros: Roteiro[], id: number | null): Ponto | null {
  if (id === null) return null;
  const r = roteiros.find((x) => x.id === id);
  return r?.status === 'EM_ANDAMENTO' && r.posicao ? r.posicao : null;
}

/** O mapa dá zoom de rua quando passa a seguir um furgão (ligou ou trocou de furgão); seguindo o mesmo, só recentraliza. */
export function precisaZoom(seguidoAntes: number | null, agora: number | null): boolean {
  return agora !== null && agora !== seguidoAntes;
}
