// Calendário de coletas: funções puras sobre datas YYYY-MM-DD (UTC).
// Dia da semana: 1 = segunda ... 6 = sábado, 0 = domingo. Domingo nunca tem coleta.

export type Frequencia = 'DIARIA' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL';
export type RegraContrato = { frequencia: Frequencia; diasSemana: number[]; diaMes: number | null; inicio: string };

const FREQUENCIAS: Frequencia[] = ['DIARIA', 'SEMANAL', 'QUINZENAL', 'MENSAL'];
const DIA_MS = 86_400_000;
const LIMITE_BUSCA_DIAS = 400;

function paraMs(data: string): number {
  const [a, m, d] = data.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

function deMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function diaDaSemana(data: string): number {
  return new Date(paraMs(data)).getUTCDay();
}

export function somarDias(data: string, dias: number): string {
  return deMs(paraMs(data) + dias * DIA_MS);
}

export function proximoDiaOperacao(data: string): string {
  const prox = somarDias(data, 1);
  return diaDaSemana(prox) === 0 ? somarDias(prox, 1) : prox;
}

function diasEntre(de: string, ate: string): number {
  return Math.round((paraMs(ate) - paraMs(de)) / DIA_MS);
}

/** Data de coleta do mês: dia limitado ao último do mês; domingo passa para a segunda. */
function dataMensal(ano: number, mes: number, diaMes: number): string {
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const data = deMs(Date.UTC(ano, mes, Math.min(diaMes, ultimo)));
  return diaDaSemana(data) === 0 ? somarDias(data, 1) : data;
}

export function caiNaData(regra: RegraContrato, data: string): boolean {
  if (data < regra.inicio) return false;
  const dow = diaDaSemana(data);
  if (dow === 0) return false;
  switch (regra.frequencia) {
    case 'DIARIA':
      return true;
    case 'SEMANAL':
      return regra.diasSemana.includes(dow);
    case 'QUINZENAL': {
      const alvo = regra.diasSemana[0];
      if (dow !== alvo) return false;
      const primeira = somarDias(regra.inicio, (alvo - diaDaSemana(regra.inicio) + 7) % 7);
      return diasEntre(primeira, data) % 14 === 0;
    }
    case 'MENSAL': {
      if (regra.diaMes === null) return false;
      const [a, m] = data.split('-').map(Number);
      // o mês anterior cobre o domingo do dia 31 (ou último) que vira segunda dia 1
      return dataMensal(a, m - 1, regra.diaMes) === data || dataMensal(a, m - 2, regra.diaMes) === data;
    }
  }
}

export function proximasColetas(regra: RegraContrato, aPartirDe: string, n: number): string[] {
  const achadas: string[] = [];
  let data = aPartirDe;
  for (let i = 0; i < LIMITE_BUSCA_DIAS && achadas.length < n; i++, data = somarDias(data, 1)) {
    if (caiNaData(regra, data)) achadas.push(data);
  }
  return achadas;
}

function dataValida(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && deMs(paraMs(s)) === s;
}

export function validarRegra(regra: unknown): RegraContrato {
  if (typeof regra !== 'object' || regra === null) throw new Error('Regra de contrato inválida.');
  const x = regra as Record<string, unknown>;
  if (!FREQUENCIAS.includes(x.frequencia as Frequencia)) throw new Error('Frequência inválida.');
  const frequencia = x.frequencia as Frequencia;
  if (!dataValida(x.inicio)) throw new Error('Data de início inválida (use AAAA-MM-DD).');
  let diasSemana: number[] = [];
  let diaMes: number | null = null;
  if (frequencia === 'SEMANAL' || frequencia === 'QUINZENAL') {
    const brutos = Array.isArray(x.diasSemana) ? x.diasSemana : [];
    if (!brutos.every((d) => Number.isInteger(d) && d >= 1 && d <= 6))
      throw new Error('Dias da semana devem ir de 1 (segunda) a 6 (sábado).');
    diasSemana = [...new Set(brutos as number[])].sort((a, b) => a - b);
    if (frequencia === 'SEMANAL' && diasSemana.length < 1) throw new Error('Informe ao menos um dia da semana.');
    if (frequencia === 'QUINZENAL' && diasSemana.length !== 1) throw new Error('Quinzenal exige exatamente um dia da semana.');
  } else if (frequencia === 'MENSAL') {
    if (!Number.isInteger(x.diaMes) || (x.diaMes as number) < 1 || (x.diaMes as number) > 31)
      throw new Error('Dia do mês deve ser um inteiro de 1 a 31.');
    diaMes = x.diaMes as number;
  }
  return { frequencia, diasSemana, diaMes, inicio: x.inicio };
}
