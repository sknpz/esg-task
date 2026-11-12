// Reset da demonstração: o banco volta a ser o de um recém-criado (o seed vence, histórico incluído) e a rodada sobe.

import type { Contexto } from './contexto.ts';
import { transacao } from './db.ts';
import { criarOperacao, esquecerPausa, publicarRoteiros, type EstadoOperacao } from './operacao.ts';
import { popularSeVazio } from './seed.ts';

/** Filhas antes das mães (as chaves estrangeiras estão ligadas). */
const TABELAS_EM_ORDEM = [
  'simulacao_comandos',
  'paradas',
  'alertas',
  'movimentacoes',
  'leituras',
  'bombonas',
  'roteiros',
  'dispositivos',
  'contratos',
  'clientes',
  'operacao',
];

/**
 * Apaga tudo, repopula com o seed e recria a operação (pausada, 1x, manhã do primeiro dia) na rodada seguinte.
 * Síncrona: o `node:sqlite` é síncrono, então nenhum pedido entra no meio.
 */
export function resetarSimulacao(ctx: Contexto): EstadoOperacao {
  const { db } = ctx;
  const linha = db.prepare('SELECT rodada FROM operacao WHERE id = 1').get() as { rodada: number } | undefined;
  const rodada = (linha?.rodada ?? 1) + 1;
  transacao(db, () => {
    for (const tabela of TABELAS_EM_ORDEM) db.exec(`DELETE FROM ${tabela}`);
  });
  popularSeVazio(db, ctx.config); // abre a própria transação
  esquecerPausa(db);
  const estado = criarOperacao(ctx, rodada);
  ctx.eventos.emitir({ tipo: 'reset', dados: estado });
  ctx.eventos.emitir({ tipo: 'operacao', dados: estado });
  publicarRoteiros(ctx, estado.data);
  return estado;
}
