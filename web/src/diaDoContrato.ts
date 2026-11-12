import type { Frequencia } from './api.ts';

/** Os campos do formulário de contrato que a regra do dia lê e preenche. */
export type CamposDia = { frequencia: Frequencia; inicio: string; diasSemana: number[]; diaMes: string };

/**
 * Dia da semana (1 = segunda … 6 = sábado) e do mês de uma data AAAA-MM-DD. Domingo nunca tem coleta: vira segunda.
 * Data inválida (inclusive o campo vazio enquanto se digita) dá null.
 */
export function diaDoInicio(inicio: string): { diaSemana: number; diaMes: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inicio);
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
  return { diaSemana: data.getUTCDay() || 1, diaMes: dia };
}

/**
 * Preenche o dia a partir do Início, para a frequência atual: semanal/quinzenal marcam só o dia da semana do Início;
 * mensal usa o dia do mês. Diária, ou Início inválido, devolve o formulário como está.
 */
export function aplicarDiaDoInicio<T extends CamposDia>(f: T): T {
  const dia = diaDoInicio(f.inicio);
  if (!dia) return f;
  if (f.frequencia === 'SEMANAL' || f.frequencia === 'QUINZENAL') return { ...f, diasSemana: [dia.diaSemana] };
  if (f.frequencia === 'MENSAL') return { ...f, diaMes: String(dia.diaMes) };
  return f;
}

const MS_DIA = 86_400_000;
const paraData = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ultimoDiaDoMes = (ano: number, mes0: number) => new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();

/**
 * O sentido contrário de `aplicarDiaDoInicio`: a próxima data, a partir de `hoje` (inclusive), que cai num dos dias
 * marcados. Semanal/quinzenal: o dia da semana mais próximo entre os marcados. Mensal: o dia do mês neste mês ou no
 * próximo (mês sem esse dia cai no último dia, como no calendário do servidor). Diária, nada marcado ou data
 * inválida: null.
 */
export function proximaData(hoje: string, frequencia: Frequencia, diasSemana: number[], diaMes: string): string | null {
  if (!diaDoInicio(hoje)) return null;
  const [ano, mes, dia] = hoje.split('-').map(Number);
  const base = Date.UTC(ano, mes - 1, dia);
  if (frequencia === 'SEMANAL' || frequencia === 'QUINZENAL') {
    for (let d = 0; d < 7; d++) {
      const data = new Date(base + d * MS_DIA);
      if (diasSemana.includes(data.getUTCDay())) return paraData(data.getTime());
    }
    return null;
  }
  if (frequencia === 'MENSAL') {
    const alvo = Number(diaMes);
    if (!Number.isInteger(alvo) || alvo < 1 || alvo > 31 || diaMes.trim() === '') return null;
    const neste = Math.min(alvo, ultimoDiaDoMes(ano, mes - 1));
    if (neste >= dia) return paraData(Date.UTC(ano, mes - 1, neste));
    return paraData(Date.UTC(ano, mes, Math.min(alvo, ultimoDiaDoMes(ano, mes))));
  }
  return null;
}

/** Marcar/desmarcar um dia (ou mudar o dia do mês) leva o Início para a próxima data nesse dia; os dias ficam como estão. */
export function aplicarInicioDoDia<T extends CamposDia>(f: T, hoje: string): T {
  const inicio = proximaData(hoje, f.frequencia, f.diasSemana, f.diaMes);
  return inicio ? { ...f, inicio } : f;
}
