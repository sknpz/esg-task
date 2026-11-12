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
