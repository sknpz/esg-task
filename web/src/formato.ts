import type { Frequencia, Severidade, Status, TipoAlerta } from './api.ts';

export const rotuloStatus: Record<Status, string> = {
  PATIO: 'No pátio',
  EM_ROTA: 'Em rota',
  EM_CLIENTE: 'No cliente',
  EXTRAVIADA: 'Extraviada',
};

export const rotuloAlerta: Record<TipoAlerta, string> = {
  FORA_DA_AREA: 'Fora da área',
  EXTRAVIO: 'Extravio',
  SEM_SINAL: 'Sem sinal',
  BATERIA_BAIXA: 'Bateria baixa',
  COLETA_ABAIXO: 'Coleta abaixo do esperado',
};

export const rotuloSeveridade: Record<Severidade, string> = { INFO: 'Info', AVISO: 'Aviso', CRITICO: 'Crítico' };

export const rotuloMovimentacao: Record<string, string> = {
  SAIDA_PARA_ENTREGA: 'Saiu para entrega',
  ENTREGA_CONCLUIDA: 'Entregue no cliente',
  COLETA: 'Coletada',
  RECUPERACAO: 'Recuperada',
  RETORNO_AO_PATIO: 'Chegou ao pátio',
};

export const rotuloRisco = { BAIXO: 'Baixo', MEDIO: 'Médio', ALTO: 'Alto' } as const;

export function distancia(metros: number | null | undefined) {
  if (metros === null || metros === undefined) return '—';
  if (metros < 1000) return `${Math.round(metros)} m`;
  return `${(metros / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}

export function tempoRelativo(iso: string | null | undefined, agora = Date.now()) {
  if (!iso) return '—';
  const s = Math.round((agora - new Date(iso).getTime()) / 1000);
  if (s < 5) return 'agora';
  if (s < 60) return `há ${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
}

export const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export const moeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export const numero = (valor: number) => valor.toLocaleString('pt-BR');

export const nomeDia = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "2026-11-09" → "seg, 09/11" (datas de operação são texto AAAA-MM-DD, em UTC). */
export function formatarDataOperacao(data: string) {
  const [, m, d] = data.split('-');
  return `${nomeDia[new Date(`${data}T00:00:00Z`).getUTCDay()]}, ${d}/${m}`;
}

export const dataCurta = (data: string) => formatarDataOperacao(data).replace(',', '');

export function rotuloFrequencia(c: { frequencia: Frequencia; diasSemana: number[]; diaMes: number | null }) {
  const dias = c.diasSemana.map((d) => nomeDia[d]).join(', ');
  switch (c.frequencia) {
    case 'DIARIA':
      return 'Diária';
    case 'SEMANAL':
      return `Semanal · ${dias}`;
    case 'QUINZENAL':
      return `Quinzenal · ${dias}`;
    case 'MENSAL':
      return `Mensal · dia ${c.diaMes}`;
  }
}
