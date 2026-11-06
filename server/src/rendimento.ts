import { abrirAlerta, resolverAvisoDeColetaDoCliente } from './alertas.ts';
import type { alertaPorId } from './consultas.ts';
import type { Config } from './config.ts';
import type { Banco } from './db.ts';

type Alerta = NonNullable<ReturnType<typeof alertaPorId>>;

/** RN18: média dos litros das últimas `n` coletas normais do cliente; `null` se houver menos de `n`. */
export function litrosEsperados(db: Banco, clienteId: number, n: number): number | null {
  const linhas = db
    .prepare(
      `SELECT litros FROM movimentacoes
       WHERE cliente_id = ? AND tipo = 'COLETA' AND litros IS NOT NULL
       ORDER BY criado_em DESC, id DESC LIMIT ?`,
    )
    .all(clienteId, n) as Array<{ litros: number }>;
  if (linhas.length < n) return null;
  return linhas.reduce((soma, l) => soma + l.litros, 0) / n;
}

/** RN18: avisa quando a coleta fica abaixo de `coletaMinimoPct`% do esperado. Devolve os alertas tocados. */
export function avaliarColeta(
  db: Banco,
  config: Config,
  c: { bombonaId: number; clienteId: number; litros: number; esperado: number | null; em: string },
): Alerta[] {
  if (c.esperado === null || c.litros >= (c.esperado * config.coletaMinimoPct) / 100) return [];
  const tocados: Alerta[] = resolverAvisoDeColetaDoCliente(db, c.clienteId, {
    por: 'SISTEMA',
    texto: 'Substituído por uma coleta mais recente',
    em: c.em,
  }).filter((a): a is Alerta => a !== null && a !== undefined);
  const novo = abrirAlerta(db, {
    bombonaId: c.bombonaId,
    clienteId: c.clienteId,
    tipo: 'COLETA_ABAIXO',
    severidade: 'AVISO',
    mensagem: `Coleta de ${c.litros} L, esperado ~${Math.round(c.esperado)} L (média das últimas ${config.coletaHistoricoN} coletas)`,
    em: c.em,
  });
  if (novo) tocados.push(novo);
  return tocados;
}
