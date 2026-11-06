import type { Contexto } from './contexto.ts';
import { agoraIso, type Banco } from './db.ts';
import { proximasColetas, proximoDiaOperacao, validarRegra, type Frequencia, type RegraContrato } from './calendario.ts';
import { ErroDeNegocio } from './operacoes.ts';

export type ContratoDto = {
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

type Linha = {
  id: number;
  clienteId: number;
  nome: string;
  cidade: string;
  quantidade: number;
  frequencia: Frequencia;
  diasSemana: string;
  diaMes: number | null;
  inicio: string;
  situacao: 'ATIVO' | 'ENCERRADO';
};

const SELECT = `SELECT k.id, k.cliente_id AS clienteId, c.nome, c.cidade, k.quantidade, k.frequencia,
                       k.dias_semana AS diasSemana, k.dia_mes AS diaMes, k.inicio, k.situacao
                FROM contratos k JOIN clientes c ON c.id = k.cliente_id`;

/** Regra de calendário de uma linha de contrato (`dias_semana` guarda "1,3,5"). */
export function regraDoContrato(l: { frequencia: Frequencia; diasSemana: string; diaMes: number | null; inicio: string }): RegraContrato {
  const diasSemana = l.diasSemana === '' ? [] : l.diasSemana.split(',').map(Number);
  return { frequencia: l.frequencia, diasSemana, diaMes: l.diaMes, inicio: l.inicio };
}

/**
 * De onde contar as próximas coletas de cada contrato. Se o dia de hoje já foi planejado (há paradas nele), o contrato
 * sem parada hoje só coleta a partir do próximo dia de operação (RN20: o planejamento não é refeito). Prepara a
 * consulta uma vez; devolve a função por contrato.
 */
function inicioDasProximas(db: Banco, hoje: string): (contratoId: number) => string {
  const linhas = db.prepare('SELECT DISTINCT contrato_id AS id FROM paradas WHERE data = ?').all(hoje) as Array<{ id: number }>;
  if (linhas.length === 0) return () => hoje;
  const comParada = new Set(linhas.map((p) => p.id));
  const seguinte = proximoDiaOperacao(hoje);
  return (contratoId) => (comParada.has(contratoId) ? hoje : seguinte);
}

function paraDto(l: Linha, aPartirDe: string): ContratoDto {
  const regra = regraDoContrato(l);
  const { diasSemana } = regra;
  return {
    id: l.id,
    clienteId: l.clienteId,
    cliente: { nome: l.nome, cidade: l.cidade },
    quantidade: l.quantidade,
    frequencia: l.frequencia,
    diasSemana,
    diaMes: l.diaMes,
    inicio: l.inicio,
    situacao: l.situacao,
    proximas: l.situacao === 'ATIVO' ? proximasColetas(regra, aPartirDe, 3) : [],
  };
}

/** Data corrente da operação; antes de a linha existir (Task 4), a data inicial configurada. */
export function dataOperacao(ctx: Contexto): string {
  const linha = ctx.db.prepare('SELECT data FROM operacao WHERE id = 1').get() as { data: string } | undefined;
  return linha?.data ?? ctx.config.dataInicialOperacao;
}

export function listarContratos(db: Banco, hoje: string): ContratoDto[] {
  const linhas = db.prepare(`${SELECT} ORDER BY c.nome, k.id`).all() as Linha[];
  const inicio = inicioDasProximas(db, hoje);
  return linhas.map((l) => paraDto(l, inicio(l.id)));
}

export function contratoPorId(db: Banco, id: number, hoje: string): ContratoDto | undefined {
  const l = db.prepare(`${SELECT} WHERE k.id = ?`).get(id) as Linha | undefined;
  return l ? paraDto(l, inicioDasProximas(db, hoje)(l.id)) : undefined;
}

function regraDaEntrada(entrada: unknown): { regra: RegraContrato; quantidade: number } {
  const x = (entrada ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(x.quantidade) || (x.quantidade as number) < 1)
    throw new ErroDeNegocio(400, 'Quantidade deve ser um inteiro de pelo menos 1.');
  try {
    return { regra: validarRegra(x), quantidade: x.quantidade as number };
  } catch (erro) {
    throw new ErroDeNegocio(400, (erro as Error).message);
  }
}

const violouUnicidade = (e: unknown) => /UNIQUE/i.test((e as Error)?.message ?? '');

export function criarContrato(ctx: Contexto, entrada: unknown): ContratoDto {
  const x = (entrada ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(x.clienteId)) throw new ErroDeNegocio(400, 'clienteId é obrigatório.');
  const { regra, quantidade } = regraDaEntrada(entrada);
  if (!ctx.db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(x.clienteId as number))
    throw new ErroDeNegocio(404, 'Cliente não encontrado');
  const agora = agoraIso();
  let id: number;
  try {
    id = Number(
      ctx.db
        .prepare(
          `INSERT INTO contratos (cliente_id, quantidade, frequencia, dias_semana, dia_mes, inicio, criado_em, atualizado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(x.clienteId as number, quantidade, regra.frequencia, regra.diasSemana.join(','), regra.diaMes, regra.inicio, agora, agora)
        .lastInsertRowid,
    );
  } catch (erro) {
    if (violouUnicidade(erro)) throw new ErroDeNegocio(409, 'Este cliente já tem um contrato ativo.');
    throw erro;
  }
  return contratoPorId(ctx.db, id, dataOperacao(ctx))!;
}

export function editarContrato(ctx: Contexto, id: number, entrada: unknown): ContratoDto {
  const atual = ctx.db.prepare('SELECT situacao FROM contratos WHERE id = ?').get(id) as { situacao: string } | undefined;
  if (!atual) throw new ErroDeNegocio(404, 'Contrato não encontrado');
  if (atual.situacao === 'ENCERRADO') throw new ErroDeNegocio(409, 'Contrato encerrado não pode ser alterado.');
  const x = (entrada ?? {}) as Record<string, unknown>;
  if (x.situacao !== undefined && x.situacao !== 'ATIVO' && x.situacao !== 'ENCERRADO')
    throw new ErroDeNegocio(400, 'Situação inválida.');
  const { regra, quantidade } = regraDaEntrada(entrada);
  const encerrar = x.situacao === 'ENCERRADO';
  ctx.db
    .prepare(
      `UPDATE contratos SET quantidade = ?, frequencia = ?, dias_semana = ?, dia_mes = ?, inicio = ?,
              situacao = ?, retirada_pendente = ?, atualizado_em = ? WHERE id = ?`,
    )
    .run(
      quantidade, regra.frequencia, regra.diasSemana.join(','), regra.diaMes, regra.inicio,
      encerrar ? 'ENCERRADO' : 'ATIVO', encerrar ? 1 : 0, agoraIso(), id,
    );
  return contratoPorId(ctx.db, id, dataOperacao(ctx))!;
}
