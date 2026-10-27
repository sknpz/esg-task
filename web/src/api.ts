export type Status = 'PATIO' | 'EM_ROTA' | 'EM_CLIENTE' | 'EXTRAVIADA';
export type TipoAlerta = 'FORA_DA_AREA' | 'EXTRAVIO' | 'SEM_SINAL' | 'BATERIA_BAIXA';
export type Severidade = 'INFO' | 'AVISO' | 'CRITICO';
export type Cenario = 'VENDA' | 'DEVOLUCAO' | 'SEM_SINAL' | 'BATERIA_FRACA';

export type Ponto = { lat: number; lng: number };
export type Local = Ponto & { nome: string; raioM: number };

export type Bombona = {
  id: number;
  codigo: string;
  capacidadeL: number;
  status: Status;
  cliente: { id: number; nome: string; cidade: string } | null;
  dispositivoId: string;
  posicao: Ponto | null;
  bateria: number | null;
  ultimoSinal: string | null;
  alertasAbertos: TipoAlerta[];
  localEsperado: Local | null;
  destino: Local | null;
  distanciaM: number | null;
  atualizadoEm: string;
};

export type Alerta = {
  id: number;
  tipo: TipoAlerta;
  severidade: Severidade;
  mensagem: string;
  status: 'ABERTO' | 'RESOLVIDO';
  abertoEm: string;
  resolvidoEm: string | null;
  resolvidoPor: 'SISTEMA' | 'OPERADOR' | null;
  resolucao: string | null;
  bombona: string;
  clienteId: number | null;
  cliente: string | null;
};

export type Movimentacao = { id: number; tipo: string; observacao: string | null; criadoEm: string; cliente: string | null };

export type DetalheBombona = Bombona & { movimentacoes: Movimentacao[]; alertas: Alerta[] };

export type PontoTrilha = Ponto & { bateria: number; registradoEm: string; dentroCerca: 0 | 1 | null };

export type Cliente = {
  id: number;
  nome: string;
  tipo: string;
  cidade: string;
  endereco: string;
  lat: number;
  lng: number;
  raioM: number;
  bombonas: number;
  incidentes: number;
  ultimoIncidente: string | null;
  risco: 'BAIXO' | 'MEDIO' | 'ALTO';
};

export type Indicadores = {
  total: number;
  porStatus: Record<Status, number>;
  alertasAbertos: number;
  alertasCriticos: number;
  valorEmRisco: number;
  capacidadeEmCampoL: number;
};

export type Configuracao = {
  patio: Local & { endereco: string };
  extravioMetros: number;
  semSinalSegundos: number;
  bateriaMinima: number;
};

async function requisitar<T>(caminho: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(`/api${caminho}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? `Erro ${resposta.status}`);
  return corpo as T;
}

const enviar = <T>(caminho: string, corpo: unknown) => requisitar<T>(caminho, { method: 'POST', body: JSON.stringify(corpo) });

export const api = {
  configuracao: () => requisitar<Configuracao>('/configuracao'),
  indicadores: () => requisitar<Indicadores>('/indicadores'),
  bombonas: () => requisitar<Bombona[]>('/bombonas'),
  bombona: (codigo: string) => requisitar<DetalheBombona>(`/bombonas/${codigo}`),
  trilha: (codigo: string) => requisitar<PontoTrilha[]>(`/bombonas/${codigo}/trilha?limite=400`),
  clientes: () => requisitar<Cliente[]>('/clientes'),
  alertas: (status?: 'ABERTO' | 'RESOLVIDO') => requisitar<Alerta[]>(`/alertas${status ? `?status=${status}` : ''}`),
  entregar: (codigo: string, clienteId: number, observacao?: string) =>
    enviar<Bombona>(`/bombonas/${codigo}/entrega`, { clienteId, observacao }),
  coletar: (codigo: string, observacao?: string) => enviar<Bombona>(`/bombonas/${codigo}/coleta`, { observacao }),
  resolverAlerta: (id: number, observacao: string) => enviar<Alerta>(`/alertas/${id}/resolver`, { observacao }),
  simular: (bombona: string, tipo: Cenario) => enviar<unknown>('/simulacao/comandos', { bombona, tipo }),
};
