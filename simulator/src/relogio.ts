/**
 * Regras de tempo do simulador: modo (tempo real/demonstração), velocidade (1x/2x), pausa e reinício. Funções puras, para testar sem rede.
 * O tick continua sendo o mesmo; a velocidade só aumenta o que se faz em cada um.
 */

/** Ritmo dos furgões vindo do servidor: REAL (80 km/h de verdade) ou DEMO (cada roteiro em ~90 s). */
export type Modo = 'REAL' | 'DEMO';

/** Consumo de bateria por ms, em pontos percentuais (calibrado para a demonstração). */
const CONSUMO_MOVIMENTO_POR_MS = 0.05 / 3000;
const CONSUMO_PARADA_POR_MS = 0.01 / 3000;
/** Folga do cenário "sem sinal" além do prazo configurado, para o servidor perceber o silêncio. */
const FOLGA_SEM_SINAL_S = 25;

/**
 * Em tempo real a bateria gasta como um rastreador de verdade: o consumo da demonstração dividido por este fator
 * (~1%/h andando, ~0,2%/h parada).
 */
export const FATOR_BATERIA_REAL = 60;

/** Bateria gasta num tick: nada pausado; em 2x, o dobro; em tempo real, 1/FATOR_BATERIA_REAL. */
export function consumoDeBateria(emMovimento: boolean, pausado: boolean, velocidade: number, tickMs: number, modo: Modo): number {
  if (pausado) return 0;
  const demo = (emMovimento ? CONSUMO_MOVIMENTO_POR_MS : CONSUMO_PARADA_POR_MS) * tickMs * velocidade;
  return modo === 'REAL' ? demo / FATOR_BATERIA_REAL : demo;
}

/** Quanto o rastreador fica calado no cenário "sem sinal", em tempo SIMULADO (o mesmo relógio do prazo do servidor). */
export function silencioDoCenarioMs(semSinalSegundos: number): number {
  return (semSinalSegundos + FOLGA_SEM_SINAL_S) * 1000;
}

/** Silêncio que ainda falta, em tempo simulado: pausado, o prazo do servidor está congelado; em 2x, corre dobrado. */
export function consumirSilencio(restanteMs: number | undefined, pausado: boolean, velocidade: number, decorridoMs: number): number | undefined {
  return pausado || restanteMs === undefined ? restanteMs : restanteMs - decorridoMs * velocidade;
}

/** A simulação foi reiniciada no servidor? Só vale se já havia uma rodada vista. */
export function rodadaMudou(vista: number | undefined, atual: number): boolean {
  return vista !== undefined && vista !== atual;
}
