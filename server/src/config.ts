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
  tokenSimulador: string;
};

export function carregarConfig(): Config {
  return {
    porta: num('PORT', 3333),
    caminhoBanco: process.env.DB_PATH ?? path.join(import.meta.dirname, '..', 'data', 'bombonas.db'),
    patio: {
      nome: 'Pátio Bio Óleo',
      endereco: 'Parque Industrial, Cianorte-PR (endereço fictício)',
      lat: -23.642,
      lng: -52.583,
      raioM: num('PATIO_RAIO_M', 250),
    },
    extravioMetros: num('EXTRAVIO_METROS', 2000),
    // Produção sugerida: 21600 (6 h). O padrão é curto para a demonstração.
    semSinalSegundos: num('SEM_SINAL_SEGUNDOS', 45),
    bateriaMinima: num('BATERIA_MINIMA', 20),
    bateriaRecuperada: num('BATERIA_RECUPERADA', 30),
    tokenSimulador: process.env.SIM_TOKEN ?? 'sim-demo-token',
  };
}
