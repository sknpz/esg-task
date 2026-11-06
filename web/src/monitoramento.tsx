import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type Alerta, type Bombona, type Cliente, type Configuracao, type Indicadores, type Operacao, type Roteiro } from './api.ts';
import { rotuloAlerta } from './formato.ts';

/** Notificação na tela: alerta novo ou etapa concluída (como o push "pedido entregue"). */
export type Aviso = { id: string; tom: 'CRITICO' | 'AVISO' | 'ETAPA'; titulo: string; texto: string; bombona: string };

/** Etapas que acontecem sozinhas (pela leitura do rastreador) e merecem aviso. As do operador ele já viu. */
function etapaConcluida(antes: Bombona | undefined, depois: Bombona) {
  if (!antes) return null;
  if (antes.status === 'EM_ROTA' && depois.status === 'EM_CLIENTE') {
    return { titulo: `Entregue · ${depois.codigo}`, texto: `Chegou em ${depois.cliente?.nome}.` };
  }
  if (antes.status === 'EM_ROTA' && depois.status === 'PATIO') {
    return { titulo: `Chegou ao pátio · ${depois.codigo}`, texto: 'Disponível para a próxima entrega.' };
  }
  if (antes.status === 'PATIO' && depois.status === 'PATIO' && (antes.bateria ?? 100) < 90 && (depois.bateria ?? 0) >= 99) {
    return { titulo: `Rastreador recarregado · ${depois.codigo}`, texto: `Bateria de ${Math.round(antes.bateria!)}% para ${Math.round(depois.bateria!)}%.` };
  }
  return null;
}

type Monitoramento = {
  carregado: boolean;
  conectado: boolean;
  config: Configuracao | null;
  bombonas: Record<string, Bombona>;
  clientes: Cliente[];
  alertasAbertos: Alerta[];
  indicadores: Indicadores | null;
  operacao: Operacao | null;
  roteiros: Roteiro[];
  avisos: Aviso[];
  agora: number;
  dispensarAviso: (id: string) => void;
  atualizarBombona: (b: Bombona) => void;
  recarregar: () => void;
};

const Contexto = createContext<Monitoramento | null>(null);

export function useMonitoramento() {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useMonitoramento fora do ProvedorDeMonitoramento');
  return ctx;
}

/**
 * Junta várias chamadas seguidas numa só, no máximo uma a cada `ms`. O prazo não recomeça a cada chamada:
 * com leituras chegando sem parar, a função nunca rodaria e os indicadores ficariam congelados.
 */
function useAgrupado(fn: () => void, ms: number) {
  const timer = useRef<number | undefined>(undefined);
  return useCallback(() => {
    if (timer.current !== undefined) return;
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      fn();
    }, ms);
  }, [fn, ms]);
}

export function ProvedorDeMonitoramento({ children }: { children: ReactNode }) {
  const [carregado, setCarregado] = useState(false);
  const [conectado, setConectado] = useState(false);
  const [config, setConfig] = useState<Configuracao | null>(null);
  const [bombonas, setBombonas] = useState<Record<string, Bombona>>({});
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [alertasAbertos, setAlertasAbertos] = useState<Alerta[]>([]);
  const [indicadores, setIndicadores] = useState<Indicadores | null>(null);
  const [operacao, setOperacao] = useState<Operacao | null>(null);
  const [roteiros, setRoteiros] = useState<Roteiro[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [agora, setAgora] = useState(Date.now());

  const atualizarBombona = useCallback((b: Bombona) => setBombonas((atual) => ({ ...atual, [b.codigo]: b })), []);
  // Cópia para o ouvinte de eventos comparar o antes e o depois sem se reinscrever a cada mudança.
  const bombonasRef = useRef(bombonas);
  bombonasRef.current = bombonas;

  const mostrarAviso = useCallback((aviso: Aviso) => {
    setAvisos((atual) => [...atual.slice(-3), aviso]);
    window.setTimeout(() => setAvisos((atual) => atual.filter((a) => a.id !== aviso.id)), 9000);
  }, []);

  const recarregarResumo = useCallback(() => {
    api.indicadores().then(setIndicadores).catch(() => {});
    api.alertas('ABERTO').then(setAlertasAbertos).catch(() => {});
    api.clientes().then(setClientes).catch(() => {});
  }, []);
  const recarregarResumoAgrupado = useAgrupado(recarregarResumo, 400);

  // As leituras chegam dezenas de vezes por segundo: um único redesenho por lote, não um por leitura.
  const pendentes = useRef<Record<string, Bombona>>({});
  const aplicarPendentes = useCallback(() => {
    const lote = pendentes.current;
    pendentes.current = {};
    setBombonas((atual) => ({ ...atual, ...lote }));
  }, []);
  const aplicarPendentesAgrupado = useAgrupado(aplicarPendentes, 100);

  // Furgões do dia: só os da data corrente da operação. Chamado a cada evento 'operacao', porque um roteiro
  // apagado na saída não emite evento próprio.
  const recarregarRoteiros = useCallback(async (data?: string) => {
    const dia = await api.roteiros(data);
    setRoteiros(dia.roteiros);
  }, []);

  const recarregar = useCallback(async () => {
    const [cfg, lista, op] = await Promise.all([api.configuracao(), api.bombonas(), api.operacao()]);
    setConfig(cfg);
    setOperacao(op);
    recarregarRoteiros(op.data).catch(() => {});
    setBombonas(Object.fromEntries(lista.map((b) => [b.codigo, b])));
    recarregarResumo();
    setCarregado(true);
  }, [recarregarResumo, recarregarRoteiros]);

  useEffect(() => {
    recarregar().catch(() => setCarregado(true));
    const relogio = window.setInterval(() => setAgora(Date.now()), 5000);
    return () => window.clearInterval(relogio);
  }, [recarregar]);

  useEffect(() => {
    const fonte = new EventSource('/api/eventos');
    let primeiraConexao = true;
    fonte.onopen = () => {
      setConectado(true);
      // Depois de uma queda, o que mudou nesse meio-tempo não chegou por evento.
      if (!primeiraConexao) recarregar().catch(() => {});
      primeiraConexao = false;
    };
    fonte.onerror = () => setConectado(false);
    fonte.addEventListener('bombona', (e) => {
      const bombona: Bombona = JSON.parse((e as MessageEvent).data);
      const etapa = etapaConcluida(pendentes.current[bombona.codigo] ?? bombonasRef.current[bombona.codigo], bombona);
      if (etapa) mostrarAviso({ id: `etapa-${bombona.codigo}-${Date.now()}`, tom: 'ETAPA', bombona: bombona.codigo, ...etapa });
      pendentes.current[bombona.codigo] = bombona;
      aplicarPendentesAgrupado();
      recarregarResumoAgrupado();
    });
    fonte.addEventListener('alerta', (e) => {
      const alerta: Alerta = JSON.parse((e as MessageEvent).data);
      recarregarResumoAgrupado();
      if (alerta.status === 'ABERTO' && alerta.severidade !== 'INFO') {
        mostrarAviso({
          id: `alerta-${alerta.id}`,
          tom: alerta.severidade,
          titulo: `${rotuloAlerta[alerta.tipo]} · ${alerta.bombona}`,
          texto: alerta.mensagem,
          bombona: alerta.bombona,
        });
      }
    });
    fonte.addEventListener('operacao', (e) => {
      const op: Operacao = JSON.parse((e as MessageEvent).data);
      setOperacao(op);
      recarregarRoteiros(op.data).catch(() => {});
    });
    fonte.addEventListener('roteiro', (e) => {
      const roteiro: Roteiro = JSON.parse((e as MessageEvent).data);
      setRoteiros((atual) =>
        atual.some((r) => r.id === roteiro.id)
          ? atual.map((r) => (r.id === roteiro.id ? roteiro : r))
          : [...atual, roteiro].sort((a, b) => a.numero - b.numero),
      );
    });
    fonte.addEventListener('furgao', (e) => {
      const { roteiroId, lat, lng }: { roteiroId: number; lat: number; lng: number } = JSON.parse((e as MessageEvent).data);
      setRoteiros((atual) => atual.map((r) => (r.id === roteiroId ? { ...r, posicao: { lat, lng } } : r)));
    });
    return () => fonte.close();
  }, [aplicarPendentesAgrupado, recarregar, recarregarResumoAgrupado, recarregarRoteiros, mostrarAviso]);

  const dispensarAviso = useCallback((id: string) => setAvisos((atual) => atual.filter((a) => a.id !== id)), []);

  const valor = useMemo(
    () => ({
      carregado,
      conectado,
      config,
      bombonas,
      clientes,
      alertasAbertos,
      indicadores,
      operacao,
      roteiros,
      avisos,
      agora,
      dispensarAviso,
      atualizarBombona,
      recarregar: () => void recarregar(),
    }),
    [carregado, conectado, config, bombonas, clientes, alertasAbertos, indicadores, operacao, roteiros, avisos, agora, dispensarAviso, atualizarBombona, recarregar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
