// Operação do dia: relógio simulado (manhã → rotas → fim do dia), planejamento das coletas e saída dos furgões.
// RN20 (coletas do dia), RN23 (capacidade e frota), RN24 (estoque do pátio).

import { abrirAlerta } from './alertas.ts';
import { caiNaData, diaDaSemana, proximoDiaOperacao, type Frequencia } from './calendario.ts';
import type { Config } from './config.ts';
import { bombonaDto, linhaBombonaPorId, type LinhaBombona } from './consultas.ts';
import type { Contexto } from './contexto.ts';
import { regraDoContrato } from './contratos.ts';
import { agoraIso, transacao, type Banco } from './db.ts';
import type { Ponto } from './geo.ts';
import { coletarEmTransacao, ErroDeNegocio } from './operacoes.ts';
import { litrosEsperados } from './rendimento.ts';
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

  // Bombonas que a troca procuraria no cliente (as "antigas" da Task 5).
  const doCliente = db.prepare(
    "SELECT COUNT(*) AS n FROM bombonas WHERE cliente_id = ? AND status IN ('EM_CLIENTE', 'EXTRAVIADA') AND roteiro_id IS NULL",
  );

  const porCliente = new Map<number, Candidata>();
  const candidata = (k: LinhaContrato, motivo: MotivoParada, vazias: number): Candidata => {
    const { n } = noCliente.get(k.clienteId) as { n: number };
    return { clienteId: k.clienteId, lat: k.lat, lng: k.lng, demanda: Math.max(vazias, n), contratoId: k.id, motivo, vazias };
  };
  for (const k of contratos)
    if (k.situacao === 'ATIVO' && caiNaData(regraDoContrato(k), data)) porCliente.set(k.clienteId, candidata(k, 'COLETA', k.quantidade));
  // Retirada pendente: descartada se o cliente já tem contrato novo ativo (a próxima coleta dele troca tudo) ou se
  // não há bombona dele para buscar. Em todo caso a pendência é zerada: a retirada acontece no máximo uma vez.
  const comContratoAtivo = new Set(contratos.filter((k) => k.situacao === 'ATIVO').map((k) => k.clienteId));
  for (const k of contratos) {
    if (k.situacao !== 'ENCERRADO' || comContratoAtivo.has(k.clienteId) || porCliente.has(k.clienteId)) continue;
    if ((doCliente.get(k.clienteId) as { n: number }).n === 0) continue;
    porCliente.set(k.clienteId, candidata(k, 'RETIRADA', 0));
  }
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
  // RN23: o que não coube não é remarcado, nem a retirada (a pendência já foi zerada acima).
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
  const apagarRoteiro = db.prepare('DELETE FROM roteiros WHERE id = ?');

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
    if (ordem === 0) apagarRoteiro.run(r.id);
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

// ---------------------------------------------------------------- troca na parada (RN21, RN22)

const NAO_PASSOU = 'o furgão encerrou a rota antes desta parada';

type LinhaStatusRoteiro = { id: number; data: string; status: StatusRoteiro };

function exigirRoteiro(db: Banco, roteiroId: number): LinhaStatusRoteiro {
  const r = db.prepare('SELECT id, data, status FROM roteiros WHERE id = ?').get(roteiroId) as LinhaStatusRoteiro | undefined;
  if (!r) throw new ErroDeNegocio(404, 'Roteiro não encontrado');
  return r;
}

function exigirEmAndamento(db: Banco, roteiroId: number): LinhaStatusRoteiro {
  const r = exigirRoteiro(db, roteiroId);
  if (r.status !== 'EM_ANDAMENTO') throw new ErroDeNegocio(409, `O roteiro não está em andamento (status atual: ${r.status})`);
  return r;
}

const paradaPorId = (db: Banco, id: number) => db.prepare(`${SELECT_PARADA} WHERE p.id = ?`).get(id) as LinhaParada | undefined;

/** Bombonas que a troca procura no cliente: as dele, paradas lá ou já dadas como extraviadas. */
const antigasDoCliente = (db: Banco, clienteId: number) =>
  (
    db
      .prepare(
        "SELECT id FROM bombonas WHERE cliente_id = ? AND status IN ('EM_CLIENTE', 'EXTRAVIADA') AND roteiro_id IS NULL ORDER BY codigo",
      )
      .all(clienteId) as Array<{ id: number }>
  ).map(({ id }) => linhaBombonaPorId(db, id)!);

/**
 * RN22: a não encontrada conta incidente só se o sumiço ainda não foi visto desde a última vez que ela foi deixada
 * nesse cliente (sem entrega registrada, desde sempre): nem pelo rastreador (FORA_DA_AREA) nem por uma parada
 * anterior (NAO_ENCONTRADA), para o mesmo sumiço não contar duas vezes.
 */
function contaIncidente(db: Banco, bombonaId: number, clienteId: number): boolean {
  const { entrega } = db
    .prepare(
      `SELECT COALESCE(MAX(criado_em), '') AS entrega FROM movimentacoes
       WHERE bombona_id = ? AND cliente_id = ? AND tipo = 'ENTREGA_CONCLUIDA'`,
    )
    .get(bombonaId, clienteId) as { entrega: string };
  const visto = db
    .prepare(
      `SELECT 1 FROM alertas WHERE bombona_id = ? AND tipo = 'FORA_DA_AREA' AND aberto_em >= ?
       UNION ALL
       SELECT 1 FROM movimentacoes WHERE bombona_id = ? AND tipo = 'NAO_ENCONTRADA' AND criado_em >= ?
       LIMIT 1`,
    )
    .get(bombonaId, entrega, bombonaId, entrega);
  return !visto;
}

type Encontradas = { encontradas: { codigo: string; litros: number }[] };

/** Litros informados por código; valida a forma da entrada (400). */
function lerEncontradas(entrada: Encontradas): Map<string, unknown> {
  const lista: unknown = (entrada as { encontradas?: unknown } | null | undefined)?.encontradas;
  if (!Array.isArray(lista)) throw new ErroDeNegocio(400, 'encontradas deve ser uma lista de { codigo, litros }');
  const porCodigo = new Map<string, unknown>();
  for (const item of lista as unknown[]) {
    const codigo = (item as { codigo?: unknown } | null)?.codigo;
    if (typeof codigo !== 'string' || !codigo.trim()) throw new ErroDeNegocio(400, 'Cada bombona encontrada precisa do código');
    const chave = codigo.trim().toUpperCase();
    if (!porCodigo.has(chave)) porCodigo.set(chave, (item as { litros?: unknown }).litros);
  }
  return porCodigo;
}

/**
 * RN21: a troca na parada. Leva as bombonas do cliente encontradas (coleta com litros, RN17/RN18), registra as não
 * encontradas (RN22) e deixa as vazias que o furgão trouxe para o cliente. Tudo ou nada.
 */
export function registrarTroca(ctx: Contexto, roteiroId: number, paradaId: number, entrada: Encontradas): ParadaDto {
  const { db } = ctx;
  const tocadas = new Set<number>();
  const alertas: unknown[] = [];

  const parada = transacao(db, () => {
    exigirEmAndamento(db, roteiroId);
    const p = paradaPorId(db, paradaId);
    if (!p || p.roteiro_id !== roteiroId) throw new ErroDeNegocio(404, 'Parada não encontrada neste roteiro');
    if (p.status !== 'PENDENTE') throw new ErroDeNegocio(409, `Parada já ${p.status === 'FEITA' ? 'feita' : 'não atendida'}`);

    const informadas = lerEncontradas(entrada);
    const antigas = antigasDoCliente(db, p.cliente_id);
    const encontrada = (b: LinhaBombona) => b.status === 'EM_CLIENTE' && informadas.has(b.codigo);

    // RN17: valida todos os litros antes de mexer em qualquer coisa.
    const litrosDe = new Map<number, number>();
    for (const b of antigas.filter(encontrada)) {
      const litros = informadas.get(b.codigo);
      if (typeof litros !== 'number' || !Number.isInteger(litros) || litros < 0 || litros > b.capacidade_l) {
        throw new ErroDeNegocio(400, `Litros de ${b.codigo}: número inteiro de 0 a ${b.capacidade_l} L`);
      }
      litrosDe.set(b.id, litros);
    }

    const agora = agoraIso();
    const resultado: ResultadoParada = { deixadas: [], levadas: [], naoEncontradas: [] };
    const naoEncontrada = db.prepare(
      "INSERT INTO movimentacoes (bombona_id, tipo, cliente_id, observacao, incidente, criado_em) VALUES (?, 'NAO_ENCONTRADA', ?, ?, ?, ?)",
    );
    const extraviar = db.prepare("UPDATE bombonas SET status = 'EXTRAVIADA', atualizado_em = ? WHERE id = ?");

    for (const b of antigas) {
      tocadas.add(b.id);
      if (encontrada(b)) {
        const litros = litrosDe.get(b.id)!;
        alertas.push(...coletarEmTransacao(ctx, b, { litros, observacao: 'Levada na troca', roteiroId }));
        resultado.levadas.push({ codigo: b.codigo, litros });
        continue;
      }
      const incidente = contaIncidente(db, b.id, p.cliente_id);
      naoEncontrada.run(b.id, p.cliente_id, 'Não encontrada na troca', Number(incidente), agora);
      if (b.status !== 'EXTRAVIADA') extraviar.run(agora, b.id);
      alertas.push(
        abrirAlerta(db, {
          bombonaId: b.id,
          clienteId: p.cliente_id,
          tipo: 'EXTRAVIO',
          severidade: 'CRITICO',
          mensagem: `Não encontrada na coleta de ${p.nome}`,
          em: agora,
        }),
      );
      resultado.naoEncontradas.push({ codigo: b.codigo, incidente });
    }

    // As vazias que o furgão trouxe para este cliente (a retirada não traz nenhuma).
    const vazias = db
      .prepare('SELECT id, codigo FROM bombonas WHERE roteiro_id = ? AND cliente_id = ? ORDER BY codigo')
      .all(roteiroId, p.cliente_id) as Array<{ id: number; codigo: string }>;
    const deixar = db.prepare(
      "UPDATE bombonas SET status = 'EM_CLIENTE', roteiro_id = NULL, leituras_fora = 0, atualizado_em = ? WHERE id = ?",
    );
    const entrega = db.prepare(
      "INSERT INTO movimentacoes (bombona_id, tipo, cliente_id, observacao, criado_em) VALUES (?, 'ENTREGA_CONCLUIDA', ?, 'Deixada na troca', ?)",
    );
    for (const v of vazias) {
      deixar.run(agora, v.id);
      entrega.run(v.id, p.cliente_id, agora);
      tocadas.add(v.id);
      resultado.deixadas.push(v.codigo);
    }

    db.prepare("UPDATE paradas SET status = 'FEITA', resultado = ?, feita_em = ? WHERE id = ?").run(JSON.stringify(resultado), agora, p.id);
    return paradaDto(paradaPorId(db, p.id)!);
  });

  publicarBombonas(ctx, [...tocadas]);
  for (const alerta of alertas) if (alerta) ctx.eventos.emitir({ tipo: 'alerta', dados: alerta });
  publicarRoteiro(ctx, roteiroId);
  return parada;
}

/**
 * O furgão voltou ao pátio: paradas que ficaram para trás viram não atendidas, as cheias são descarregadas e as
 * vazias que sobraram voltam ao estoque. Nenhuma bombona continua presa ao roteiro.
 */
export function concluirRoteiro(ctx: Contexto, roteiroId: number): RoteiroDto {
  const { db } = ctx;
  const devolvidas = transacao(db, () => {
    exigirEmAndamento(db, roteiroId);
    const agora = agoraIso();
    db.prepare("UPDATE paradas SET status = 'NAO_ATENDIDA', resultado = ? WHERE roteiro_id = ? AND status = 'PENDENTE'").run(
      JSON.stringify(naoAtendida(NAO_PASSOU)),
      roteiroId,
    );
    const noFurgao = db.prepare('SELECT id, cliente_id AS clienteId FROM bombonas WHERE roteiro_id = ? ORDER BY codigo').all(roteiroId) as Array<{
      id: number;
      clienteId: number | null;
    }>;
    const descarregar = db.prepare(
      "UPDATE bombonas SET status = 'PATIO', cliente_id = NULL, roteiro_id = NULL, leituras_fora = 0, atualizado_em = ? WHERE id = ?",
    );
    const retorno = db.prepare(
      "INSERT INTO movimentacoes (bombona_id, tipo, cliente_id, observacao, criado_em) VALUES (?, 'RETORNO_AO_PATIO', NULL, ?, ?)",
    );
    for (const b of noFurgao) {
      descarregar.run(agora, b.id);
      retorno.run(b.id, b.clienteId === null ? 'Descarregada no pátio' : 'Voltou ao pátio sem ser deixada', agora);
    }
    db.prepare("UPDATE roteiros SET status = 'CONCLUIDO', concluido_em = ? WHERE id = ?").run(agora, roteiroId);
    return noFurgao.map((b) => b.id);
  });
  publicarBombonas(ctx, devolvidas);
  return publicarRoteiro(ctx, roteiroId);
}

const numeroFinito = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Desenho do roteiro pelas ruas (uma consulta OSRM do simulador) e a distância total. */
export function registrarTrajeto(ctx: Contexto, roteiroId: number, entrada: { pontos: [number, number][]; distanciaM: number }): RoteiroDto {
  const { pontos, distanciaM } = (entrada ?? {}) as { pontos?: unknown; distanciaM?: unknown };
  const valido =
    Array.isArray(pontos) &&
    pontos.length >= 2 &&
    pontos.every((pt) => Array.isArray(pt) && pt.length === 2 && numeroFinito(pt[0]) && numeroFinito(pt[1]));
  if (!valido) throw new ErroDeNegocio(400, 'pontos deve ser uma lista de pelo menos 2 pares [lat, lng]');
  if (!numeroFinito(distanciaM) || distanciaM < 0) throw new ErroDeNegocio(400, 'distanciaM deve ser um número maior ou igual a 0');
  const r = exigirRoteiro(ctx.db, roteiroId);
  if (r.status === 'CONCLUIDO') throw new ErroDeNegocio(409, 'O roteiro já foi concluído');
  ctx.db.prepare('UPDATE roteiros SET trajeto = ?, distancia_m = ? WHERE id = ?').run(JSON.stringify(pontos), distanciaM, roteiroId);
  return publicarRoteiro(ctx, roteiroId);
}

/** Posição atual do furgão. */
export function registrarPosicao(ctx: Contexto, roteiroId: number, entrada: { lat: number; lng: number }): RoteiroDto {
  const { lat, lng } = (entrada ?? {}) as { lat?: unknown; lng?: unknown };
  if (!numeroFinito(lat) || !numeroFinito(lng)) throw new ErroDeNegocio(400, 'lat e lng devem ser números');
  exigirEmAndamento(ctx.db, roteiroId);
  ctx.db.prepare('UPDATE roteiros SET lat = ?, lng = ? WHERE id = ?').run(lat, lng, roteiroId);
  return publicarRoteiro(ctx, roteiroId);
}

/**
 * Servidor reiniciado com furgão na rua: as paradas restantes são feitas como se o furgão tivesse passado (todas
 * as bombonas em cliente encontradas, litros no esperado do cliente ou 70% da capacidade) e o roteiro é concluído.
 * Sem roteiro em andamento, não faz nada.
 */
export function retomarAposReinicio(ctx: Contexto): void {
  const { db, config } = ctx;
  const emAndamento = db.prepare("SELECT id FROM roteiros WHERE status = 'EM_ANDAMENTO' ORDER BY data, numero").all() as Array<{ id: number }>;
  for (const { id } of emAndamento) {
    const pendentes = db
      .prepare("SELECT id, cliente_id AS clienteId FROM paradas WHERE roteiro_id = ? AND status = 'PENDENTE' ORDER BY ordem")
      .all(id) as Array<{ id: number; clienteId: number }>;
    for (const p of pendentes) {
      const esperado = litrosEsperados(db, p.clienteId, config.coletaHistoricoN);
      const encontradas = antigasDoCliente(db, p.clienteId)
        .filter((b) => b.status === 'EM_CLIENTE')
        .map((b) => ({
          codigo: b.codigo,
          litros: Math.max(0, Math.min(b.capacidade_l, Math.round(esperado ?? b.capacidade_l * 0.7))),
        }));
      registrarTroca(ctx, id, p.id, { encontradas });
    }
    concluirRoteiro(ctx, id);
  }
}

// ---------------------------------------------------------------- eventos

function publicarRoteiro(ctx: Contexto, roteiroId: number): RoteiroDto {
  const dto = roteiroDto(ctx.db, ctx.config, roteiroId)!;
  ctx.eventos.emitir({ tipo: 'roteiro', dados: dto });
  return dto;
}

function publicarRoteiros(ctx: Contexto, data: string) {
  for (const r of roteirosDoDia(ctx.db, ctx.config, data).roteiros) ctx.eventos.emitir({ tipo: 'roteiro', dados: r });
}

function publicarBombonas(ctx: Contexto, ids: number[]) {
  for (const id of ids) ctx.eventos.emitir({ tipo: 'bombona', dados: bombonaDto(ctx.db, ctx.config, id) });
}
