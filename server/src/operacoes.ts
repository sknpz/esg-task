import { resolverAlertasDaBombona } from './alertas.ts';
import { alertaPorId, bombonaDto, linhaBombonaPorCodigo } from './consultas.ts';
import type { Contexto } from './contexto.ts';
import { agoraIso, transacao } from './db.ts';

export class ErroDeNegocio extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

const registrarMovimentacao = (ctx: Contexto, bombonaId: number, tipo: string, clienteId: number | null, observacao?: string) =>
  ctx.db
    .prepare('INSERT INTO movimentacoes (bombona_id, tipo, cliente_id, observacao, criado_em) VALUES (?, ?, ?, ?, ?)')
    .run(bombonaId, tipo, clienteId, observacao?.trim() || null, agoraIso());

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

/** RN05: coleta normal (EM_CLIENTE) ou recuperação (EXTRAVIADA). A bombona volta ao pátio. */
export function coletar(ctx: Contexto, codigo: string, observacao?: string) {
  const b = exigirBombona(ctx, codigo);
  if (b.status !== 'EM_CLIENTE' && b.status !== 'EXTRAVIADA') {
    throw new ErroDeNegocio(409, `Só é possível coletar bombonas em cliente ou extraviadas (status atual: ${b.status})`);
  }
  const recuperacao = b.status === 'EXTRAVIADA';

  const alertas = transacao(ctx.db, () => {
    ctx.db
      .prepare("UPDATE bombonas SET status = 'EM_ROTA', cliente_id = NULL, leituras_fora = 0, atualizado_em = ? WHERE id = ?")
      .run(agoraIso(), b.id);
    registrarMovimentacao(ctx, b.id, recuperacao ? 'RECUPERACAO' : 'COLETA', b.cliente_id, observacao);
    return resolverAlertasDaBombona(ctx.db, b.id, ['FORA_DA_AREA', 'EXTRAVIO'], {
      por: 'OPERADOR',
      texto: observacao?.trim() || 'Bombona recolhida pela equipe de coleta',
      em: agoraIso(),
    });
  });
  return publicarBombona(ctx, b.id, alertas);
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
