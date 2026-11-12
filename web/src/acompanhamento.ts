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
