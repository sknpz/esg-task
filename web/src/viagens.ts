import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bombona, Ponto } from './api.ts';
import { buscarRota, comprimento, trechoRestante } from './rota.ts';

/** Acompanhamento de uma bombona em rota, como a previsão de chegada do delivery. */
export type Viagem = {
  /** Caminho pelas ruas que ainda falta (ou a linha reta, se o serviço de rotas não respondeu). */
  caminho: Ponto[];
  restanteM: number;
  /** Instante previsto de chegada (ms). null enquanto não há leituras suficientes ou se está parada. */
  chegadaEm: number | null;
  parada: boolean;
};

const hora = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** "Chega em ~4 min · 19:42", no formato da previsão de entrega. */
export function textoPrevisao(v: Viagem, agora: number) {
  if (v.parada) return 'Parada no caminho';
  if (v.chegadaEm === null) return 'Calculando previsão…';
  const segundos = (v.chegadaEm - agora) / 1000;
  if (segundos < 60) return `Chega em menos de 1 min · ${hora(v.chegadaEm)}`;
  return `Chega em ~${Math.round(segundos / 60)} min · ${hora(v.chegadaEm)}`;
}

/** Versão curta para a lista: "~4 min". */
export function textoCurtoPrevisao(v: Viagem, agora: number) {
  if (v.parada) return 'parada';
  if (v.chegadaEm === null) return null;
  return `~${Math.max(1, Math.round((v.chegadaEm - agora) / 60_000))} min`;
}

type Amostra = { t: number; restanteM: number };

/** Leituras usadas para estimar a velocidade (as mais recentes). */
const AMOSTRAS = 6;
/** Abaixo disso (m/s) a bombona é considerada parada. */
const VELOCIDADE_MINIMA = 0.5;

const destinoDe = (b: Bombona) => b.destino ?? b.localEsperado;
const chaveDe = (b: Bombona) => {
  const d = destinoDe(b);
  return d ? `${b.codigo}:${d.lat},${d.lng}` : null;
};

/**
 * Para cada bombona em rota: busca a rota pelas ruas uma vez por destino, mede quanto falta por ela
 * e estima a chegada pela velocidade das últimas leituras.
 */
export function useViagens(bombonas: Record<string, Bombona>): Record<string, Viagem> {
  const emRota = useMemo(() => Object.values(bombonas).filter((b) => b.status === 'EM_ROTA' && b.posicao && destinoDe(b)), [bombonas]);
  const [rotas, setRotas] = useState<Record<string, Ponto[] | null>>({});
  const pedidas = useRef(new Set<string>());
  const amostras = useRef<Record<string, { chave: string; lista: Amostra[] }>>({});

  useEffect(() => {
    for (const b of emRota) {
      const chave = chaveDe(b)!;
      if (pedidas.current.has(chave)) continue;
      pedidas.current.add(chave);
      buscarRota(b.posicao!, destinoDe(b)!).then((rota) => setRotas((atual) => ({ ...atual, [chave]: rota })));
    }
  }, [emRota]);

  return useMemo(() => {
    const resultado: Record<string, Viagem> = {};
    for (const b of emRota) {
      const chave = chaveDe(b)!;
      const rota = rotas[chave];
      const caminho = rota ? trechoRestante(rota, b.posicao!) : [b.posicao!, destinoDe(b)!];
      const restanteM = comprimento(caminho);

      // Uma amostra por leitura. Trocar de destino, ou a rota chegar depois da linha reta, recomeça a conta:
      // misturar as duas medidas faria a distância "crescer" e a bombona parecer parada.
      const t = b.ultimoSinal ? Date.parse(b.ultimoSinal) : Date.now();
      const chaveAmostra = `${chave}:${rota ? 'rota' : 'reta'}`;
      const registro = amostras.current[b.codigo]?.chave === chaveAmostra ? amostras.current[b.codigo] : { chave: chaveAmostra, lista: [] };
      const ultima = registro.lista[registro.lista.length - 1];
      if (!ultima || ultima.t !== t) registro.lista = [...registro.lista, { t, restanteM }].slice(-AMOSTRAS);
      amostras.current[b.codigo] = registro;

      const [primeira, atual] = [registro.lista[0], registro.lista[registro.lista.length - 1]];
      const segundos = (atual.t - primeira.t) / 1000;
      const velocidade = segundos > 0 ? (primeira.restanteM - atual.restanteM) / segundos : null;
      const parada = velocidade !== null && velocidade < VELOCIDADE_MINIMA;
      resultado[b.codigo] = {
        caminho,
        restanteM,
        chegadaEm: velocidade && !parada ? atual.t + (restanteM / velocidade) * 1000 : null,
        parada,
      };
    }
    return resultado;
  }, [emRota, rotas]);
}
