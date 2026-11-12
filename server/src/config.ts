import path from 'node:path';

const num = (nome: string, padrao: number) => {
  const bruto = process.env[nome];
  if (!bruto) return padrao;
  const valor = Number(bruto);
  return Number.isFinite(valor) ? valor : padrao;
};

export type Config = {
  porta: number;
  caminhoBanco: string;
  patio: { nome: string; endereco: string; lat: number; lng: number; raioM: number };
  extravioMetros: number;
  semSinalSegundos: number;
  bateriaMinima: number;
  bateriaRecuperada: number;
  coletaHistoricoN: number;
  coletaMinimoPct: number;
  dataInicialOperacao: string;
  furgaoCapacidade: number;
  frotaMaxima: number;
  fasePausaS: number;
  tokenSimulador: string;
  simulacaoAtiva: boolean;
};

export function carregarConfig(): Config {
  return {
    porta: num('PORT', 3333),
    caminhoBanco: process.env.DB_PATH ?? path.join(import.meta.dirname, '..', 'data', 'bombonas.db'),
    patio: {
      nome: 'Pátio Bio Óleo',
      endereco: 'Rod. Bento Fernandes Dias, Cianorte-PR (plus code 78MR+R9)',
      lat: -23.71544,
      lng: -52.65906,
      raioM: num('PATIO_RAIO_M', 250),
    },
    extravioMetros: num('EXTRAVIO_METROS', 2000),
    // Produção sugerida: 21600 (6 h). O padrão é curto para a demonstração.
    semSinalSegundos: num('SEM_SINAL_SEGUNDOS', 45),
    bateriaMinima: num('BATERIA_MINIMA', 20),
    bateriaRecuperada: num('BATERIA_RECUPERADA', 30),
    coletaHistoricoN: num('COLETA_HISTORICO_N', 3),
    coletaMinimoPct: num('COLETA_MINIMO_PCT', 50),
    dataInicialOperacao: process.env.DATA_INICIAL_OPERACAO ?? '2026-11-09',
    // RN23: bombonas por furgão e furgões por dia. Capacidade pequena para a divisão aparecer na demonstração.
    furgaoCapacidade: num('FURGAO_CAPACIDADE', 8),
    frotaMaxima: num('FROTA_MAXIMA', 4),
    // Duração da manhã e do fim do dia simulados, em segundos.
    fasePausaS: num('FASE_PAUSA_S', 5),
    tokenSimulador: process.env.SIM_TOKEN ?? 'sim-demo-token',
    // Canal de controle da demonstração; desligue com SIMULACAO=off.
    simulacaoAtiva: process.env.SIMULACAO !== 'off',
  };
}
