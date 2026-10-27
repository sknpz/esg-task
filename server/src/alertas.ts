import { alertaPorId } from './consultas.ts';
import type { Banco } from './db.ts';

export type TipoAlerta = 'FORA_DA_AREA' | 'EXTRAVIO' | 'SEM_SINAL' | 'BATERIA_BAIXA';
export type Severidade = 'INFO' | 'AVISO' | 'CRITICO';

/** Abre um alerta se ainda não houver um aberto do mesmo tipo (RN12). Devolve o alerta criado ou `null`. */
export function abrirAlerta(
  db: Banco,
  alerta: { bombonaId: number; clienteId: number | null; tipo: TipoAlerta; severidade: Severidade; mensagem: string; em: string },
) {
  const { changes, lastInsertRowid } = db
    .prepare(
      `INSERT OR IGNORE INTO alertas (bombona_id, cliente_id, tipo, severidade, mensagem, aberto_em)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(alerta.bombonaId, alerta.clienteId, alerta.tipo, alerta.severidade, alerta.mensagem, alerta.em);
  return changes > 0 ? alertaPorId(db, Number(lastInsertRowid)) : null;
}

/** Resolve os alertas abertos dos tipos informados. Devolve os alertas resolvidos. */
export function resolverAlertasDaBombona(
  db: Banco,
  bombonaId: number,
  tipos: TipoAlerta[],
  resolucao: { por: 'SISTEMA' | 'OPERADOR'; texto: string; em: string },
) {
  const marcadores = tipos.map(() => '?').join(', ');
  const ids = db
    .prepare(
      `UPDATE alertas SET status = 'RESOLVIDO', resolvido_em = ?, resolvido_por = ?, resolucao = ?
       WHERE bombona_id = ? AND status = 'ABERTO' AND tipo IN (${marcadores})
       RETURNING id`,
    )
    .all(resolucao.em, resolucao.por, resolucao.texto, bombonaId, ...tipos) as Array<{ id: number }>;
  return ids.map(({ id }) => alertaPorId(db, id));
}

export function temAlertaAberto(db: Banco, bombonaId: number, tipo: TipoAlerta) {
  return Boolean(db.prepare("SELECT 1 FROM alertas WHERE bombona_id = ? AND tipo = ? AND status = 'ABERTO'").get(bombonaId, tipo));
}
