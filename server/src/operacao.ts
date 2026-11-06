// Operação do dia: relógio simulado (manhã → rotas → fim do dia), planejamento das coletas e saída dos furgões.
// RN20 (coletas do dia), RN23 (capacidade e frota), RN24 (estoque do pátio).

import { caiNaData, diaDaSemana, proximoDiaOperacao, type Frequencia } from './calendario.ts';
import type { Config } from './config.ts';
import { bombonaDto } from './consultas.ts';
import type { Contexto } from './contexto.ts';
import { regraDoContrato } from './contratos.ts';
import { agoraIso, transacao, type Banco } from './db.ts';
import type { Ponto } from './geo.ts';
import { dividirEmRoteiros, type ParadaPlano } from './roteirizacao.ts';

export type Fase = 'MANHA' | 'ROTAS' | 'FIM';
export type EstadoOperacao = { data: string; diaSemana: number; fase: Fase; pausado: boolean };

export type MotivoParada = 'COLETA' | 'RETIRADA';
export type StatusParada = 'PENDENTE' | 'FEITA' | 'NAO_ATENDIDA';
export type StatusRoteiro = 'PLANEJADO' | 'EM_ANDAMENTO' | 'CONCLUIDO';

/** O que aconteceu na parada (a troca preenche; a não atendida só traz a observação). */
export type ResultadoParada = {
  deixadas: string[];
  levadas: { codigo: string; litros: number }[];
  naoEncontradas: { codigo: string; incidente: boolean }[];
  observacao?: string;
};

export type ParadaDto = {
  id: number;
  ordem: number | null;
  cliente: { id: number; nome: string; cidade: string; lat: number; lng: number };
  motivo: MotivoParada;
  vazias: number;
  demanda: number;
  status: StatusParada;
  resultado: ResultadoParada | null;
};

export type RoteiroDto = {
  id: number;
  numero: number;
  status: StatusRoteiro;
  distanciaM: number | null;
  trajeto: [number, number][] | null;
  posicao: Ponto | null;
  capacidade: number;
  /** Soma das demandas das paradas. */
  carga: number;
  paradas: ParadaDto[];
};

const SEM_VAZIAS = 'sem bombonas vazias no pátio';
const FORA_DA_FROTA = 'não coube na frota do dia';
const ACIMA_DA_CAPACIDADE = 'mais bombonas que a capacidade do furgão';

const naoAtendida = (observacao: string): ResultadoParada => ({ deixadas: [], levadas: [], naoEncontradas: [], observacao });

// ---------------------------------------------------------------- consultas

type LinhaRoteiro = {
  id: number;
  numero: number;
  status: StatusRoteiro;
  trajeto: string | null;
  distancia_m: number | null;
  lat: number | null;
  lng: number | null;
};

type LinhaParada = {
  id: number;
  roteiro_id: number | null;
  ordem: number | null;
  cliente_id: number;
  motivo: MotivoParada;
  vazias: number;
  demanda: number;
  status: StatusParada;
  resultado: string | null;
  nome: string;
  cidade: string;
  lat: number;
  lng: number;
};

const SELECT_PARADA = `
  SELECT p.id, p.roteiro_id, p.ordem, p.cliente_id, p.motivo, p.vazias, p.demanda, p.status, p.resultado,
         c.nome, c.cidade, c.lat, c.lng
  FROM paradas p JOIN clientes c ON c.id = p.cliente_id`;
const ORDEM_PARADA = 'ORDER BY p.ordem IS NULL, p.ordem, p.cliente_id, p.id';

function paradaDto(p: LinhaParada): ParadaDto {
  return {
    id: p.id,
    ordem: p.ordem,
    cliente: { id: p.cliente_id, nome: p.nome, cidade: p.cidade, lat: p.lat, lng: p.lng },
    motivo: p.motivo,
    vazias: p.vazias,
    demanda: p.demanda,
    status: p.status,
    resultado: p.resultado === null ? null : (JSON.parse(p.resultado) as ResultadoParada),
  };
}

function montarRoteiro(r: LinhaRoteiro, paradas: LinhaParada[], config: Config): RoteiroDto {
  return {
    id: r.id,
    numero: r.numero,
    status: r.status,
    distanciaM: r.distancia_m,
    trajeto: r.trajeto === null ? null : (JSON.parse(r.trajeto) as [number, number][]),
    posicao: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
    capacidade: config.furgaoCapacidade,
    carga: paradas.reduce((soma, p) => soma + p.demanda, 0),
    paradas: paradas.map(paradaDto),
  };
}

export function roteiroDto(db: Banco, config: Config, id: number): RoteiroDto | null {
  const r = db.prepare('SELECT id, numero, status, trajeto, distancia_m, lat, lng FROM roteiros WHERE id = ?').get(id) as
    | LinhaRoteiro
    | undefined;
  if (!r) return null;
  const paradas = db.prepare(`${SELECT_PARADA} WHERE p.roteiro_id = ? ${ORDEM_PARADA}`).all(id) as LinhaParada[];
  return montarRoteiro(r, paradas, config);
}

/** Os furgões de uma data, com as paradas na ordem, e as coletas que ficaram sem furgão. */
export function roteirosDoDia(
  db: Banco,
  config: Config,
  data: string,
): { data: string; roteiros: RoteiroDto[]; naoAtendidas: ParadaDto[] } {
  const roteiros = db
    .prepare('SELECT id, numero, status, trajeto, distancia_m, lat, lng FROM roteiros WHERE data = ? ORDER BY numero')
    .all(data) as LinhaRoteiro[];
  const paradas = db.prepare(`${SELECT_PARADA} WHERE p.data = ? ${ORDEM_PARADA}`).all(data) as LinhaParada[];
  return {
    data,
    roteiros: roteiros.map((r) => montarRoteiro(r, paradas.filter((p) => p.roteiro_id === r.id), config)),
    naoAtendidas: paradas.filter((p) => p.roteiro_id === null).map(paradaDto),
  };
}

// ---------------------------------------------------------------- planejamento (RN20, RN23)

type LinhaContrato = {
  id: number;
  clienteId: number;
  quantidade: number;
  frequencia: Frequencia;
  diasSemana: string;
  diaMes: number | null;
  inicio: string;
  situacao: 'ATIVO' | 'ENCERRADO';
  lat: number;
  lng: number;
};

type Candidata = ParadaPlano & { contratoId: number; motivo: MotivoParada; vazias: number };

/** Gera as paradas e os roteiros da data. Sem transação própria; não faz nada em domingo ou data já planejada. */
function planejar(ctx: Contexto, data: string) {
  const { db, config } = ctx;
  if (diaDaSemana(data) === 0) return;
  if (db.prepare('SELECT 1 FROM paradas WHERE data = ? LIMIT 1').get(data)) return;

  const contratos = db
    .prepare(
      `SELECT k.id, k.cliente_id AS clienteId, k.quantidade, k.frequencia, k.dias_semana AS diasSemana,
              k.dia_mes AS diaMes, k.inicio, k.situacao, c.lat, c.lng
       FROM contratos k JOIN clientes c ON c.id = k.cliente_id
       WHERE k.situacao = 'ATIVO' OR k.retirada_pendente = 1
       ORDER BY k.cliente_id, k.id`,
    )
    .all() as LinhaContrato[];
  const noCliente = db.prepare(
    "SELECT COUNT(*) AS n FROM bombonas WHERE cliente_id = ? AND status = 'EM_CLIENTE' AND roteiro_id IS NULL",
  );

  // Uma parada por cliente: a coleta já leva tudo, então cobre a retirada de um contrato encerrado do mesmo cliente.
  const porCliente = new Map<number, Candidata>();
  const candidata = (k: LinhaContrato, motivo: MotivoParada, vazias: number): Candidata => {
    const { n } = noCliente.get(k.clienteId) as { n: number };
    return { clienteId: k.clienteId, lat: k.lat, lng: k.lng, demanda: Math.max(vazias, n), contratoId: k.id, motivo, vazias };
  };
  for (const k of contratos)
    if (k.situacao === 'ATIVO' && caiNaData(regraDoContrato(k), data)) porCliente.set(k.clienteId, candidata(k, 'COLETA', k.quantidade));
  for (const k of contratos)
    if (k.situacao === 'ENCERRADO' && !porCliente.has(k.clienteId)) porCliente.set(k.clienteId, candidata(k, 'RETIRADA', 0));
  db.prepare("UPDATE contratos SET retirada_pendente = 0 WHERE situacao = 'ENCERRADO' AND retirada_pendente = 1").run();

  const { roteiros, naoAtendidas } = dividirEmRoteiros(config.patio, [...porCliente.values()], config.furgaoCapacidade, config.frotaMaxima);

  const insRoteiro = db.prepare("INSERT INTO roteiros (data, numero, status) VALUES (?, ?, 'PLANEJADO')");
  const insParada = db.prepare(
    `INSERT INTO paradas (data, roteiro_id, ordem, cliente_id, contrato_id, motivo, vazias, demanda, status, resultado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  roteiros.forEach((grupo, i) => {
    const roteiroId = Number(insRoteiro.run(data, i + 1).lastInsertRowid);
    grupo.forEach((p, j) => insParada.run(data, roteiroId, j + 1, p.clienteId, p.contratoId, p.motivo, p.vazias, p.demanda, 'PENDENTE', null));
  });
  for (const p of [...naoAtendidas].sort((a, b) => a.clienteId - b.clienteId)) {
    const motivo = p.demanda > config.furgaoCapacidade ? ACIMA_DA_CAPACIDADE : FORA_DA_FROTA;
    insParada.run(data, null, null, p.clienteId, p.contratoId, p.motivo, p.vazias, p.demanda, 'NAO_ATENDIDA', JSON.stringify(naoAtendida(motivo)));
  }
}

/**
 * RN20: gera as coletas da data a partir dos contratos e as divide entre os furgões (RN23). Idempotente: se a data
 * já tem paradas, não faz nada; por isso contrato criado ou editado depois do planejamento só vale no dia seguinte.
 */
export function planejarDia(ctx: Contexto, data: string): void {
  transacao(ctx.db, () => planejar(ctx, data));
  publicarRoteiros(ctx, data);
}

// ---------------------------------------------------------------- saída dos furgões (RN24)

/** Carrega as vazias do pátio nos furgões planejados da data. Sem transação própria. Devolve as bombonas carregadas. */
function iniciar(ctx: Contexto, data: string): number[] {
  const { db } = ctx;
  const agora = agoraIso();
  const roteiros = db.prepare("SELECT id FROM roteiros WHERE data = ? AND status = 'PLANEJADO' ORDER BY numero").all(data) as Array<{
    id: number;
  }>;
  const paradasDe = db.prepare("SELECT id, cliente_id AS clienteId, vazias FROM paradas WHERE roteiro_id = ? AND status = 'PENDENTE' ORDER BY ordem");
  const vaziasDoPatio = db.prepare("SELECT id FROM bombonas WHERE status = 'PATIO' AND roteiro_id IS NULL ORDER BY codigo LIMIT ?");
  const carregar = db.prepare(
    "UPDATE bombonas SET status = 'EM_ROTA', cliente_id = ?, roteiro_id = ?, leituras_fora = 0, atualizado_em = ? WHERE id = ?",
  );
  const saida = db.prepare(
    "INSERT INTO movimentacoes (bombona_id, tipo, cliente_id, observacao, criado_em) VALUES (?, 'SAIDA_PARA_ENTREGA', ?, ?, ?)",
  );
  const semVazias = db.prepare("UPDATE paradas SET status = 'NAO_ATENDIDA', roteiro_id = NULL, ordem = NULL, resultado = ? WHERE id = ?");
  const reordenar = db.prepare('UPDATE paradas SET ordem = ? WHERE id = ?');

  const carregadas: number[] = [];
  const saem: number[] = [];
  for (const r of roteiros) {
    let ordem = 0;
    for (const p of paradasDe.all(r.id) as Array<{ id: number; clienteId: number; vazias: number }>) {
      const vazias = p.vazias === 0 ? [] : (vaziasDoPatio.all(p.vazias) as Array<{ id: number }>);
      if (vazias.length < p.vazias) {
        semVazias.run(JSON.stringify(naoAtendida(SEM_VAZIAS)), p.id);
        continue;
      }
      for (const v of vazias) {
        carregar.run(p.clienteId, r.id, agora, v.id);
        saida.run(v.id, p.clienteId, 'Carregada no furgão para a troca', agora);
        carregadas.push(v.id);
      }
      reordenar.run(++ordem, p.id);
    }
    if (ordem === 0) db.prepare('DELETE FROM roteiros WHERE id = ?').run(r.id);
    else saem.push(r.id);
  }

  // Renumera para os furgões que saem ficarem 1, 2, 3... mesmo que algum planejado tenha sido apagado.
  const marcarSaida = db.prepare("UPDATE roteiros SET status = 'EM_ANDAMENTO', numero = ?, iniciado_em = ? WHERE id = ?");
  saem.forEach((id, i) => marcarSaida.run(i + 1, agora, id));
  return carregadas;
}

/** RN24: os furgões planejados da data saem com as vazias do pátio; parada sem vazia suficiente fica não atendida. */
export function iniciarRoteiros(ctx: Contexto, data: string): void {
  const carregadas = transacao(ctx.db, () => iniciar(ctx, data));
  publicarBombonas(ctx, carregadas);
  publicarRoteiros(ctx, data);
}

// ---------------------------------------------------------------- relógio

type LinhaOperacao = { data: string; fase: Fase; fase_desde: string; pausado: number };

const lerLinha = (db: Banco) =>
  db.prepare('SELECT data, fase, fase_desde, pausado FROM operacao WHERE id = 1').get() as LinhaOperacao | undefined;

const paraEstado = (l: LinhaOperacao): EstadoOperacao => ({
  data: l.data,
  diaSemana: diaDaSemana(l.data),
  fase: l.fase,
  pausado: l.pausado === 1,
});

/** Início da pausa em andamento, por banco. Em memória: depois de reiniciar, continuar recomeça a fase. */
const inicioDaPausa = new WeakMap<Banco, number>();

/**
 * Estado do relógio. Na primeira chamada cria a operação na data inicial, de manhã, e já planeja esse dia
 * (a manhã planeja ao começar).
 */
export function estadoOperacao(ctx: Contexto): EstadoOperacao {
  const atual = lerLinha(ctx.db);
  if (atual) return paraEstado(atual);
  const data = ctx.config.dataInicialOperacao;
  transacao(ctx.db, () => {
    ctx.db.prepare("INSERT INTO operacao (id, data, fase, fase_desde, pausado) VALUES (1, ?, 'MANHA', ?, 0)").run(data, agoraIso());
    planejar(ctx, data);
  });
  const estado = paraEstado(lerLinha(ctx.db)!);
  ctx.eventos.emitir({ tipo: 'operacao', dados: estado });
  publicarRoteiros(ctx, data);
  return estado;
}

const mudarFase = (db: Banco, fase: Fase, data: string, desde: number) =>
  db.prepare('UPDATE operacao SET fase = ?, data = ?, fase_desde = ? WHERE id = 1').run(fase, data, new Date(desde).toISOString());

/**
 * Máquina de fases, chamada a cada segundo. Pausada, não faz nada.
 * MANHA (planejada ao começar) → depois de `fasePausaS`, os furgões saem → ROTAS → quando nenhum roteiro da data
 * está em andamento → FIM → depois de `fasePausaS`, próximo dia de operação, MANHA. Uma transição por chamada.
 */
export function avancarOperacao(ctx: Contexto, agora = Date.now()): void {
  const { db, config } = ctx;
  const linha = lerLinha(db);
  if (!linha) return void estadoOperacao(ctx); // criar a operação já é a entrada na manhã
  if (linha.pausado === 1) return;
  const passouPausa = agora - Date.parse(linha.fase_desde) >= config.fasePausaS * 1000;

  if (linha.fase === 'MANHA' && passouPausa) {
    const carregadas = transacao(db, () => {
      const ids = iniciar(ctx, linha.data);
      mudarFase(db, 'ROTAS', linha.data, agora);
      return ids;
    });
    publicarBombonas(ctx, carregadas);
    publicarRoteiros(ctx, linha.data);
  } else if (linha.fase === 'ROTAS') {
    const rodando = db.prepare("SELECT 1 FROM roteiros WHERE data = ? AND status = 'EM_ANDAMENTO' LIMIT 1").get(linha.data);
    if (rodando) return;
    transacao(db, () => mudarFase(db, 'FIM', linha.data, agora));
  } else if (linha.fase === 'FIM' && passouPausa) {
    const proximo = proximoDiaOperacao(linha.data);
    transacao(db, () => {
      mudarFase(db, 'MANHA', proximo, agora);
      planejar(ctx, proximo);
    });
    publicarRoteiros(ctx, proximo);
  } else {
    return;
  }
  ctx.eventos.emitir({ tipo: 'operacao', dados: estadoOperacao(ctx) });
}

/** Congela o relógio: a fase não avança enquanto pausado. */
export function pausar(ctx: Contexto, agora = Date.now()): EstadoOperacao {
  if (estadoOperacao(ctx).pausado) return estadoOperacao(ctx);
  transacao(ctx.db, () => ctx.db.prepare('UPDATE operacao SET pausado = 1 WHERE id = 1').run());
  inicioDaPausa.set(ctx.db, agora);
  const estado = estadoOperacao(ctx);
  ctx.eventos.emitir({ tipo: 'operacao', dados: estado });
  return estado;
}

/** Solta o relógio; a fase em curso é estendida pelo tempo que ficou pausada. */
export function continuar(ctx: Contexto, agora = Date.now()): EstadoOperacao {
  if (!estadoOperacao(ctx).pausado) return estadoOperacao(ctx);
  const linha = lerLinha(ctx.db)!;
  const inicio = inicioDaPausa.get(ctx.db);
  inicioDaPausa.delete(ctx.db);
  const desde = inicio === undefined ? agora : Date.parse(linha.fase_desde) + (agora - inicio);
  transacao(ctx.db, () =>
    ctx.db.prepare('UPDATE operacao SET pausado = 0, fase_desde = ? WHERE id = 1').run(new Date(desde).toISOString()),
  );
  const estado = estadoOperacao(ctx);
  ctx.eventos.emitir({ tipo: 'operacao', dados: estado });
  return estado;
}

// ---------------------------------------------------------------- eventos

function publicarRoteiros(ctx: Contexto, data: string) {
  for (const r of roteirosDoDia(ctx.db, ctx.config, data).roteiros) ctx.eventos.emitir({ tipo: 'roteiro', dados: r });
}

function publicarBombonas(ctx: Contexto, ids: number[]) {
  for (const id of ids) ctx.eventos.emitir({ tipo: 'bombona', dados: bombonaDto(ctx.db, ctx.config, id) });
}
