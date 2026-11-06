export type Status = 'PATIO' | 'EM_ROTA' | 'EM_CLIENTE' | 'EXTRAVIADA';
export type TipoAlerta = 'FORA_DA_AREA' | 'EXTRAVIO' | 'SEM_SINAL' | 'BATERIA_BAIXA' | 'COLETA_ABAIXO';
export type Severidade = 'INFO' | 'AVISO' | 'CRITICO';
export type Cenario = 'VENDA' | 'DEVOLUCAO' | 'SEM_SINAL' | 'BATERIA_FRACA' | 'VENDA_SILENCIOSA';

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

export type Movimentacao = { id: number; tipo: string; litros: number | null; observacao: string | null; criadoEm: string; cliente: string | null };

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
  contratoAtivo: boolean;
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

export type Fase = 'MANHA' | 'ROTAS' | 'FIM';
export type Velocidade = 1 | 2;
export type Operacao = {
  data: string;
  diaSemana: number;
  fase: Fase;
  pausado: boolean;
  velocidade: Velocidade;
  rodada: number;
  dia: number;
  faseDesde: string;
  /** Já dividida pela velocidade; null enquanto os furgões estão na rua. */
  faseDuracaoMs: number | null;
};

export type Frequencia = 'DIARIA' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL';
export type Contrato = {
  id: number;
  clienteId: number;
  cliente: { nome: string; cidade: string };
  quantidade: number;
  frequencia: Frequencia;
  diasSemana: number[];
  diaMes: number | null;
  inicio: string;
  situacao: 'ATIVO' | 'ENCERRADO';
  proximas: string[];
};
export type EntradaContrato = {
  clienteId: number;
  quantidade: number;
  frequencia: Frequencia;
  diasSemana: number[];
  diaMes: number | null;
  inicio: string;
  situacao?: 'ATIVO' | 'ENCERRADO';
};

export type MotivoParada = 'COLETA' | 'RETIRADA';
export type StatusParada = 'PENDENTE' | 'FEITA' | 'NAO_ATENDIDA';
export type StatusRoteiro = 'PLANEJADO' | 'EM_ANDAMENTO' | 'CONCLUIDO';

export type ResultadoParada = {
  deixadas: string[];
  levadas: { codigo: string; litros: number }[];
  naoEncontradas: { codigo: string; incidente: boolean }[];
  observacao?: string;
};

export type Parada = {
  id: number;
  ordem: number | null;
  cliente: { id: number; nome: string; cidade: string; lat: number; lng: number };
  motivo: MotivoParada;
  vazias: number;
  demanda: number;
  status: StatusParada;
  resultado: ResultadoParada | null;
};

export type Roteiro = {
  id: number;
  numero: number;
  status: StatusRoteiro;
  distanciaM: number | null;
  trajeto: [number, number][] | null;
  posicao: Ponto | null;
  capacidade: number;
  carga: number;
  paradas: Parada[];
};

export type RoteirosDoDia = { data: string; roteiros: Roteiro[]; naoAtendidas: Parada[] };

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
  trilha: (codigo: string) => requisitar<PontoTrilha[]>(`/bombonas/${codigo}/trilha?limite=2000`),
  clientes: () => requisitar<Cliente[]>('/clientes'),
  alertas: (status?: 'ABERTO' | 'RESOLVIDO') => requisitar<Alerta[]>(`/alertas${status ? `?status=${status}` : ''}`),
  entregar: (codigo: string, clienteId: number, observacao?: string) =>
    enviar<Bombona>(`/bombonas/${codigo}/entrega`, { clienteId, observacao }),
  coletar: (codigo: string, entrada: { litros?: number; observacao?: string }) =>
    enviar<Bombona>(`/bombonas/${codigo}/coleta`, entrada),
  resolverAlerta: (id: number, observacao: string) => enviar<Alerta>(`/alertas/${id}/resolver`, { observacao }),
  simular: (bombona: string | null, tipo: Cenario) =>
    enviar<unknown>('/simulacao/comandos', bombona === null ? { tipo } : { bombona, tipo }),
  operacao: () => requisitar<Operacao>('/operacao'),
  pausar: () => enviar<Operacao>('/operacao/pausar', {}),
  continuar: () => enviar<Operacao>('/operacao/continuar', {}),
  velocidade: (velocidade: Velocidade) => enviar<Operacao>('/operacao/velocidade', { velocidade }),
  resetar: () => enviar<Operacao>('/operacao/reset', {}),
  contratos: () => requisitar<Contrato[]>('/contratos'),
  criarContrato: (e: EntradaContrato) => enviar<Contrato>('/contratos', e),
  editarContrato: (id: number, e: EntradaContrato) =>
    requisitar<Contrato>(`/contratos/${id}`, { method: 'PUT', body: JSON.stringify(e) }),
  roteiros: (data?: string) => requisitar<RoteirosDoDia>(`/roteiros${data ? `?data=${data}` : ''}`),
};
