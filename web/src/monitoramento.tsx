import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type Alerta, type Bombona, type Cliente, type Configuracao, type Indicadores } from './api.ts';

export type Aviso = { id: number; alerta: Alerta };

type Monitoramento = {
  carregado: boolean;
  conectado: boolean;
  config: Configuracao | null;
  bombonas: Record<string, Bombona>;
  clientes: Cliente[];
  alertasAbertos: Alerta[];
  indicadores: Indicadores | null;
  avisos: Aviso[];
  agora: number;
  dispensarAviso: (id: number) => void;
  atualizarBombona: (b: Bombona) => void;
  recarregar: () => void;
};

const Contexto = createContext<Monitoramento | null>(null);

export function useMonitoramento() {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useMonitoramento fora do ProvedorDeMonitoramento');
  return ctx;
}

/** Junta várias chamadas seguidas numa só (ex.: rajada de eventos). */
function useAgrupado(fn: () => void, ms: number) {
  const timer = useRef<number | undefined>(undefined);
  return useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
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
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [agora, setAgora] = useState(Date.now());

  const atualizarBombona = useCallback((b: Bombona) => setBombonas((atual) => ({ ...atual, [b.codigo]: b })), []);

  const recarregarResumo = useCallback(() => {
    api.indicadores().then(setIndicadores).catch(() => {});
    api.alertas('ABERTO').then(setAlertasAbertos).catch(() => {});
    api.clientes().then(setClientes).catch(() => {});
  }, []);
  const recarregarResumoAgrupado = useAgrupado(recarregarResumo, 400);

  const recarregar = useCallback(async () => {
    const [cfg, lista] = await Promise.all([api.configuracao(), api.bombonas()]);
    setConfig(cfg);
    setBombonas(Object.fromEntries(lista.map((b) => [b.codigo, b])));
    recarregarResumo();
    setCarregado(true);
  }, [recarregarResumo]);

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
      atualizarBombona(JSON.parse((e as MessageEvent).data));
      recarregarResumoAgrupado();
    });
    fonte.addEventListener('alerta', (e) => {
      const alerta: Alerta = JSON.parse((e as MessageEvent).data);
      recarregarResumoAgrupado();
      if (alerta.status === 'ABERTO' && alerta.severidade !== 'INFO') {
        setAvisos((atual) => [...atual.slice(-3), { id: alerta.id, alerta }]);
        window.setTimeout(() => setAvisos((atual) => atual.filter((a) => a.id !== alerta.id)), 9000);
      }
    });
    return () => fonte.close();
  }, [atualizarBombona, recarregar, recarregarResumoAgrupado]);

  const dispensarAviso = useCallback((id: number) => setAvisos((atual) => atual.filter((a) => a.id !== id)), []);

  const valor = useMemo(
    () => ({
      carregado,
      conectado,
      config,
      bombonas,
      clientes,
      alertasAbertos,
      indicadores,
      avisos,
      agora,
      dispensarAviso,
      atualizarBombona,
      recarregar: () => void recarregar(),
    }),
    [carregado, conectado, config, bombonas, clientes, alertasAbertos, indicadores, avisos, agora, dispensarAviso, atualizarBombona, recarregar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
