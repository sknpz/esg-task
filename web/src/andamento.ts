import type { Operacao, Ponto, Roteiro } from './api.ts';

const limitar = (x: number) => Math.min(1, Math.max(0, x));

/** Fração do tempo da fase que já passou (a duração da fase já vem dividida pela velocidade). */
function fracaoDaFase(op: Operacao, agora: number) {
  if (!op.faseDuracaoMs || op.faseDuracaoMs <= 0) return 0;
  return limitar((agora - new Date(op.faseDesde).getTime()) / op.faseDuracaoMs);
}

/** Metros aproximados entre dois pontos [lat, lng] (projeção plana, boa para distâncias de cidade). */
function metros(a: [number, number], b: [number, number]) {
  const dLat = (b[0] - a[0]) * 111_320;
  const dLng = (b[1] - a[1]) * 111_320 * Math.cos(((a[0] + b[0]) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLng);
}

/**
 * Quanto do trajeto o furgão já andou: distância até o ponto do trajeto mais próximo da posição, sobre o total.
 * A busca só olha do índice `aPartirDe` em diante: na volta, que repassa as mesmas ruas da ida, os pontos da ida
 * não podem "puxar" a posição para trás. A busca também tem uma janela de distância à frente (o furgão não salta
 * trechos): sem ela, numa ida e volta pela mesma estrada um ponto da volta ganharia logo na saída. Devolve também o índice achado, para a próxima chamada continuar dali.
 */
export function fracaoDoTrajeto(trajeto: [number, number][], posicao: Ponto, aPartirDe = 0): { fracao: number; indice: number } {
  if (trajeto.length < 2) return { fracao: 0, indice: 0 };
  const acumulada: number[] = [0];
  for (let i = 1; i < trajeto.length; i++) acumulada.push(acumulada[i - 1] + metros(trajeto[i - 1], trajeto[i]));
  const total = acumulada[acumulada.length - 1];
  let indice = Math.min(Math.max(0, aPartirDe), trajeto.length - 1);
  let menor = Infinity;
  const inicio = indice;
  const janela = Math.max(1000, 0.05 * total);
  for (let i = indice; i < trajeto.length; i++) {
    // Sempre olha o ponto seguinte ao inicial, mesmo que os vértices sejam mais espaçados que a janela.
    if (i > inicio + 1 && acumulada[i] > acumulada[inicio] + janela) break;
    const d = metros(trajeto[i], [posicao.lat, posicao.lng]);
    if (d < menor) {
      menor = d;
      indice = i;
    }
  }
  return { fracao: total > 0 ? limitar(acumulada[indice] / total) : 0, indice };
}

/** Índice já alcançado no trajeto de cada roteiro (id do roteiro), para a busca nunca andar para trás. */
export type IndicesDosRoteiros = Map<number, number>;

function fracaoDoRoteiro(r: Roteiro, indices?: IndicesDosRoteiros) {
  if (r.status === 'CONCLUIDO') return 1;
  if (r.status === 'PLANEJADO' || !r.trajeto || !r.posicao) return 0;
  const { fracao, indice } = fracaoDoTrajeto(r.trajeto, r.posicao, indices?.get(r.id) ?? 0);
  indices?.set(r.id, indice);
  return fracao;
}

/** Andamento do dia simulado em [0, 1]: manhã 0–10%, furgões na rua 10–90%, fim do dia 90–100%. */
export function andamentoDoDia(op: Operacao, roteiros: Roteiro[], agora: number, indices?: IndicesDosRoteiros): number {
  if (op.fase === 'MANHA') return limitar(fracaoDaFase(op, agora) * 0.1);
  if (op.fase === 'FIM') return limitar(0.9 + fracaoDaFase(op, agora) * 0.1);
  const media = roteiros.length ? roteiros.reduce((soma, r) => soma + fracaoDoRoteiro(r, indices), 0) / roteiros.length : 1;
  return limitar(0.1 + media * 0.8);
}
