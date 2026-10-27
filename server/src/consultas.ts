import type { Config } from './config.ts';
import type { Banco } from './db.ts';
import { distanciaM } from './geo.ts';

export type StatusBombona = 'PATIO' | 'EM_ROTA' | 'EM_CLIENTE' | 'EXTRAVIADA';
export type Local = { nome: string; lat: number; lng: number; raioM: number };

/** Linha de bombona com dispositivo e cliente já juntados. */
export type LinhaBombona = {
  id: number;
  codigo: string;
  capacidade_l: number;
  status: StatusBombona;
  cliente_id: number | null;
  dispositivo_id: string;
  leituras_fora: number;
  atualizado_em: string;
  bateria: number | null;
  ultimo_sinal: string | null;
  lat: number | null;
  lng: number | null;
  cliente_nome: string | null;
  cliente_cidade: string | null;
  cliente_lat: number | null;
  cliente_lng: number | null;
  cliente_raio: number | null;
  alertas_abertos: string | null;
};

const SELECT_BOMBONA = `
  SELECT b.*, d.bateria, d.ultimo_sinal, d.lat, d.lng,
         c.nome AS cliente_nome, c.cidade AS cliente_cidade,
         c.lat AS cliente_lat, c.lng AS cliente_lng, c.raio_m AS cliente_raio,
         (SELECT GROUP_CONCAT(a.tipo) FROM alertas a WHERE a.bombona_id = b.id AND a.status = 'ABERTO') AS alertas_abertos
  FROM bombonas b
  JOIN dispositivos d ON d.id = b.dispositivo_id
  LEFT JOIN clientes c ON c.id = b.cliente_id`;

export function linhaBombonaPorId(db: Banco, id: number) {
  return db.prepare(`${SELECT_BOMBONA} WHERE b.id = ?`).get(id) as LinhaBombona | undefined;
}

export function linhaBombonaPorCodigo(db: Banco, codigo: string) {
  return db.prepare(`${SELECT_BOMBONA} WHERE b.codigo = ?`).get(codigo.toUpperCase()) as LinhaBombona | undefined;
}

function localDoCliente(b: LinhaBombona): Local | null {
  if (b.cliente_id === null) return null;
  return { nome: b.cliente_nome!, lat: b.cliente_lat!, lng: b.cliente_lng!, raioM: b.cliente_raio! };
}

const localDoPatio = (config: Config): Local => ({
  nome: config.patio.nome,
  lat: config.patio.lat,
  lng: config.patio.lng,
  raioM: config.patio.raioM,
});

/** Onde a bombona deveria estar parada. `null` em rota (RN13). */
export function localEsperado(b: LinhaBombona, config: Config): Local | null {
  if (b.status === 'PATIO') return localDoPatio(config);
  if (b.status === 'EM_ROTA') return null;
  return localDoCliente(b);
}

/** Para onde a bombona em rota está indo. */
export function destino(b: LinhaBombona, config: Config): Local | null {
  if (b.status !== 'EM_ROTA') return null;
  return localDoCliente(b) ?? localDoPatio(config);
}

/** Valor hipotético de reposição de uma bombona. */
export const valorReposicao = (capacidadeL: number) => (capacidadeL >= 200 ? 420 : 150);

export function paraDto(b: LinhaBombona, config: Config) {
  const esperado = localEsperado(b, config);
  const indo = destino(b, config);
  const referencia = esperado ?? indo;
  const posicao = b.lat !== null && b.lng !== null ? { lat: b.lat, lng: b.lng } : null;
  return {
    id: b.id,
    codigo: b.codigo,
    capacidadeL: b.capacidade_l,
    status: b.status,
    cliente: b.cliente_id === null ? null : { id: b.cliente_id, nome: b.cliente_nome!, cidade: b.cliente_cidade! },
    dispositivoId: b.dispositivo_id,
    posicao,
    bateria: b.bateria,
    ultimoSinal: b.ultimo_sinal,
    alertasAbertos: b.alertas_abertos ? b.alertas_abertos.split(',') : [],
    localEsperado: esperado,
    destino: indo,
    distanciaM: posicao && referencia ? Math.round(distanciaM(posicao, referencia)) : null,
    atualizadoEm: b.atualizado_em,
  };
}

export type BombonaDto = ReturnType<typeof paraDto>;

export function listarBombonas(db: Banco, config: Config, status?: string) {
  const linhas = (
    status
      ? db.prepare(`${SELECT_BOMBONA} WHERE b.status = ? ORDER BY b.codigo`).all(status)
      : db.prepare(`${SELECT_BOMBONA} ORDER BY b.codigo`).all()
  ) as LinhaBombona[];
  return linhas.map((b) => paraDto(b, config));
}

export function bombonaDto(db: Banco, config: Config, id: number) {
  const linha = linhaBombonaPorId(db, id);
  return linha ? paraDto(linha, config) : null;
}

export function detalheBombona(db: Banco, config: Config, codigo: string) {
  const linha = linhaBombonaPorCodigo(db, codigo);
  if (!linha) return null;
  const movimentacoes = db
    .prepare(
      `SELECT m.id, m.tipo, m.observacao, m.criado_em AS criadoEm, c.nome AS cliente
       FROM movimentacoes m LEFT JOIN clientes c ON c.id = m.cliente_id
       WHERE m.bombona_id = ? ORDER BY m.criado_em DESC, m.id DESC LIMIT 30`,
    )
    .all(linha.id);
  const alertas = listarAlertas(db, { bombonaId: linha.id });
  return { ...paraDto(linha, config), movimentacoes, alertas };
}

export function trilha(db: Banco, bombonaId: number, limite = 200) {
  const pontos = db
    .prepare(
      `SELECT lat, lng, bateria, registrado_em AS registradoEm, dentro_cerca AS dentroCerca
       FROM leituras WHERE bombona_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(bombonaId, limite);
  return pontos.reverse();
}

export const nivelRisco = (incidentes: number) => (incidentes >= 3 ? 'ALTO' : incidentes >= 1 ? 'MEDIO' : 'BAIXO');

export function listarClientes(db: Banco) {
  const linhas = db
    .prepare(
      `SELECT c.id, c.nome, c.tipo, c.cidade, c.endereco, c.lat, c.lng, c.raio_m AS raioM,
              (SELECT COUNT(*) FROM bombonas b WHERE b.cliente_id = c.id AND b.status IN ('EM_CLIENTE', 'EXTRAVIADA')) AS bombonas,
              (SELECT COUNT(*) FROM alertas a WHERE a.cliente_id = c.id AND a.tipo = 'FORA_DA_AREA') AS incidentes,
              (SELECT MAX(a.aberto_em) FROM alertas a WHERE a.cliente_id = c.id AND a.tipo = 'FORA_DA_AREA') AS ultimoIncidente
       FROM clientes c ORDER BY incidentes DESC, c.nome`,
    )
    .all() as Array<{ incidentes: number }>;
  return linhas.map((c) => ({ ...c, risco: nivelRisco(c.incidentes) }));
}

export function listarAlertas(db: Banco, filtro: { status?: string; bombonaId?: number; limite?: number } = {}) {
  const condicoes: string[] = [];
  const params: Array<string | number> = [];
  if (filtro.status) {
    condicoes.push('a.status = ?');
    params.push(filtro.status);
  }
  if (filtro.bombonaId !== undefined) {
    condicoes.push('a.bombona_id = ?');
    params.push(filtro.bombonaId);
  }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT a.id, a.tipo, a.severidade, a.mensagem, a.status,
              a.aberto_em AS abertoEm, a.resolvido_em AS resolvidoEm, a.resolvido_por AS resolvidoPor, a.resolucao,
              b.codigo AS bombona, c.id AS clienteId, c.nome AS cliente
       FROM alertas a
       JOIN bombonas b ON b.id = a.bombona_id
       LEFT JOIN clientes c ON c.id = a.cliente_id
       ${where}
       ORDER BY a.status = 'ABERTO' DESC, a.aberto_em DESC, a.id DESC
       LIMIT ?`,
    )
    .all(...params, filtro.limite ?? 200);
}

export function alertaPorId(db: Banco, id: number) {
  return db
    .prepare(
      `SELECT a.id, a.tipo, a.severidade, a.mensagem, a.status,
              a.aberto_em AS abertoEm, a.resolvido_em AS resolvidoEm, a.resolvido_por AS resolvidoPor, a.resolucao,
              b.codigo AS bombona, c.id AS clienteId, c.nome AS cliente
       FROM alertas a JOIN bombonas b ON b.id = a.bombona_id LEFT JOIN clientes c ON c.id = a.cliente_id
       WHERE a.id = ?`,
    )
    .get(id);
}

export function indicadores(db: Banco) {
  const porStatus = Object.fromEntries(
    (db.prepare('SELECT status, COUNT(*) AS n FROM bombonas GROUP BY status').all() as Array<{ status: string; n: number }>).map(
      (l) => [l.status, l.n],
    ),
  );
  const alertas = db
    .prepare(
      `SELECT COUNT(*) AS abertos, COALESCE(SUM(severidade = 'CRITICO'), 0) AS criticos
       FROM alertas WHERE status = 'ABERTO'`,
    )
    .get() as { abertos: number; criticos: number };
  const extraviadas = db.prepare("SELECT capacidade_l FROM bombonas WHERE status = 'EXTRAVIADA'").all() as Array<{
    capacidade_l: number;
  }>;
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM bombonas').get() as { total: number };
  const { capacidade } = db
    .prepare("SELECT COALESCE(SUM(capacidade_l), 0) AS capacidade FROM bombonas WHERE status = 'EM_CLIENTE'")
    .get() as { capacidade: number };
  return {
    total,
    porStatus: { PATIO: 0, EM_ROTA: 0, EM_CLIENTE: 0, EXTRAVIADA: 0, ...porStatus },
    alertasAbertos: alertas.abertos,
    alertasCriticos: alertas.criticos,
    valorEmRisco: extraviadas.reduce((soma, b) => soma + valorReposicao(b.capacidade_l), 0),
    capacidadeEmCampoL: capacidade,
  };
}
