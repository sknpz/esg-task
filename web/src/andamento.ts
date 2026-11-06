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

/** Quanto do trajeto o furgão já andou: distância até o ponto do trajeto mais próximo da posição, sobre o total. */
export function fracaoDoTrajeto(trajeto: [number, number][], posicao: Ponto): number {
  if (trajeto.length < 2) return 0;
  let total = 0;
  let acumulado = 0;
  let menor = Infinity;
  let ate = 0;
  trajeto.forEach((p, i) => {
    if (i > 0) total += metros(trajeto[i - 1], p);
    const d = metros(p, [posicao.lat, posicao.lng]);
    if (d < menor) {
      menor = d;
      acumulado = total;
    }
    ate = total;
  });
  return ate > 0 ? limitar(acumulado / ate) : 0;
}

function fracaoDoRoteiro(r: Roteiro) {
  if (r.status === 'CONCLUIDO') return 1;
  if (r.status === 'PLANEJADO' || !r.trajeto || !r.posicao) return 0;
  return fracaoDoTrajeto(r.trajeto, r.posicao);
}

/** Andamento do dia simulado em [0, 1]: manhã 0–10%, furgões na rua 10–90%, fim do dia 90–100%. */
export function andamentoDoDia(op: Operacao, roteiros: Roteiro[], agora: number): number {
  if (op.fase === 'MANHA') return limitar(fracaoDaFase(op, agora) * 0.1);
  if (op.fase === 'FIM') return limitar(0.9 + fracaoDaFase(op, agora) * 0.1);
  const media = roteiros.length ? roteiros.reduce((soma, r) => soma + fracaoDoRoteiro(r), 0) / roteiros.length : 1;
  return limitar(0.1 + media * 0.8);
}
