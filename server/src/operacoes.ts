import { resolverAlertasDaBombona } from './alertas.ts';
import { avaliarColeta, litrosEsperados } from './rendimento.ts';
import { alertaPorId, bombonaDto, linhaBombonaPorCodigo, type LinhaBombona } from './consultas.ts';
import type { Contexto } from './contexto.ts';
import { agoraIso, transacao } from './db.ts';

export class ErroDeNegocio extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

const registrarMovimentacao = (
  ctx: Contexto,
  bombonaId: number,
  tipo: string,
  clienteId: number | null,
  observacao?: string,
  litros: number | null = null,
) =>
  ctx.db
    .prepare('INSERT INTO movimentacoes (bombona_id, tipo, cliente_id, observacao, litros, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
    .run(bombonaId, tipo, clienteId, observacao?.trim() || null, litros, agoraIso());

function exigirBombona(ctx: Contexto, codigo: string) {
  const b = linhaBombonaPorCodigo(ctx.db, codigo);
  if (!b) throw new ErroDeNegocio(404, 'Bombona não encontrada');
  return b;
}

function publicarBombona(ctx: Contexto, id: number, alertas: unknown[] = []) {
  const dto = bombonaDto(ctx.db, ctx.config, id)!;
  ctx.eventos.emitir({ tipo: 'bombona', dados: dto });
  for (const alerta of alertas) ctx.eventos.emitir({ tipo: 'alerta', dados: alerta });
  return dto;
}

/** RN03: só sai para entrega o que está no pátio. */
export function enviarParaCliente(ctx: Contexto, codigo: string, clienteId: number, observacao?: string) {
  const b = exigirBombona(ctx, codigo);
  if (b.status !== 'PATIO') throw new ErroDeNegocio(409, `Só é possível enviar bombonas que estão no pátio (status atual: ${b.status})`);
  if (!ctx.db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(clienteId)) throw new ErroDeNegocio(404, 'Cliente não encontrado');

  transacao(ctx.db, () => {
    ctx.db
      .prepare("UPDATE bombonas SET status = 'EM_ROTA', cliente_id = ?, leituras_fora = 0, atualizado_em = ? WHERE id = ?")
      .run(clienteId, agoraIso(), b.id);
    registrarMovimentacao(ctx, b.id, 'SAIDA_PARA_ENTREGA', clienteId, observacao);
  });
  return publicarBombona(ctx, b.id);
}

/** RN05: coleta normal (EM_CLIENTE) ou recuperação (EXTRAVIADA). A bombona volta ao pátio. RN17: a coleta normal informa os litros. */
export function coletar(ctx: Contexto, codigo: string, entrada: { litros?: unknown; observacao?: string } = {}) {
  const { observacao } = entrada;
  const b = exigirBombona(ctx, codigo);
  if (b.status !== 'EM_CLIENTE' && b.status !== 'EXTRAVIADA') {
    throw new ErroDeNegocio(409, `Só é possível coletar bombonas em cliente ou extraviadas (status atual: ${b.status})`);
  }
  const recuperacao = b.status === 'EXTRAVIADA';
  let litros: number | null = null;
  if (!recuperacao) {
    const informado = entrada.litros;
    if (typeof informado !== 'number' || !Number.isInteger(informado) || informado < 0 || informado > b.capacidade_l) {
      throw new ErroDeNegocio(400, `Informe os litros coletados: número inteiro de 0 a ${b.capacidade_l} L`);
    }
    litros = informado;
  }

  const alertas = transacao(ctx.db, () => coletarEmTransacao(ctx, b, { litros, observacao }));
  return publicarBombona(ctx, b.id, alertas);
}

/**
 * Parte transacional da coleta (RN05, RN17, RN18), sem validação nem transação própria: a bombona (EM_CLIENTE ou
 * EXTRAVIADA, litros já validados) vira EM_ROTA rumo ao pátio, no furgão `roteiroId` se houver. Devolve os alertas tocados.
 */
export function coletarEmTransacao(
  ctx: Contexto,
  b: LinhaBombona,
  opcoes: { litros: number | null; observacao?: string; roteiroId?: number | null },
): unknown[] {
  const { litros, observacao } = opcoes;
  const recuperacao = b.status === 'EXTRAVIADA';
  // RN18: o esperado é calculado antes de registrar esta coleta, para não entrar na própria média.
  const esperado = litros !== null && b.cliente_id !== null ? litrosEsperados(ctx.db, b.cliente_id, ctx.config.coletaHistoricoN) : null;
  ctx.db
    .prepare("UPDATE bombonas SET status = 'EM_ROTA', cliente_id = NULL, roteiro_id = ?, leituras_fora = 0, atualizado_em = ? WHERE id = ?")
    .run(opcoes.roteiroId ?? null, agoraIso(), b.id);
  registrarMovimentacao(ctx, b.id, recuperacao ? 'RECUPERACAO' : 'COLETA', b.cliente_id, observacao, litros);
  const resolvidos = resolverAlertasDaBombona(ctx.db, b.id, ['FORA_DA_AREA', 'EXTRAVIO'], {
    por: 'OPERADOR',
    texto: observacao?.trim() || 'Bombona recolhida pela equipe de coleta',
    em: agoraIso(),
  });
  const avisos =
    litros !== null && b.cliente_id !== null
      ? avaliarColeta(ctx.db, ctx.config, { bombonaId: b.id, clienteId: b.cliente_id, litros, esperado, em: agoraIso() })
      : [];
  return [...resolvidos, ...avisos];
}

/** RN15: resolução manual com observação obrigatória. */
export function resolverAlerta(ctx: Contexto, alertaId: number, observacao: string) {
  if (!observacao || observacao.trim().length < 3) throw new ErroDeNegocio(400, 'Informe uma observação sobre a resolução');
  const atual = ctx.db.prepare('SELECT bombona_id, status FROM alertas WHERE id = ?').get(alertaId) as
    | { bombona_id: number; status: string }
    | undefined;
  if (!atual) throw new ErroDeNegocio(404, 'Alerta não encontrado');
  if (atual.status !== 'ABERTO') throw new ErroDeNegocio(409, 'Alerta já resolvido');

  ctx.db
    .prepare("UPDATE alertas SET status = 'RESOLVIDO', resolvido_em = ?, resolvido_por = 'OPERADOR', resolucao = ? WHERE id = ?")
    .run(agoraIso(), observacao.trim(), alertaId);
  const alerta = alertaPorId(ctx.db, alertaId);
  publicarBombona(ctx, atual.bombona_id, [alerta]);
  return alerta;
}
