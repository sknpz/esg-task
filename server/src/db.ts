import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Banco = DatabaseSync;

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS clientes (
  id        INTEGER PRIMARY KEY,
  nome      TEXT    NOT NULL,
  tipo      TEXT    NOT NULL,
  cidade    TEXT    NOT NULL,
  endereco  TEXT    NOT NULL,
  lat       REAL    NOT NULL,
  lng       REAL    NOT NULL,
  raio_m    INTEGER NOT NULL DEFAULT 150
);

CREATE TABLE IF NOT EXISTS dispositivos (
  id            TEXT PRIMARY KEY,
  token         TEXT NOT NULL UNIQUE,
  modelo        TEXT NOT NULL,
  bateria       REAL,
  ultimo_sinal  TEXT,
  lat           REAL,
  lng           REAL
);

CREATE TABLE IF NOT EXISTS roteiros (
  id           INTEGER PRIMARY KEY,
  data         TEXT    NOT NULL,
  numero       INTEGER NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('PLANEJADO', 'EM_ANDAMENTO', 'CONCLUIDO')),
  trajeto      TEXT,
  distancia_m  REAL,
  lat          REAL,
  lng          REAL,
  iniciado_em  TEXT,
  concluido_em TEXT
);

CREATE TABLE IF NOT EXISTS bombonas (
  id             INTEGER PRIMARY KEY,
  codigo         TEXT    NOT NULL UNIQUE,
  capacidade_l   INTEGER NOT NULL,
  status         TEXT    NOT NULL CHECK (status IN ('PATIO', 'EM_ROTA', 'EM_CLIENTE', 'EXTRAVIADA')),
  -- EM_CLIENTE/EXTRAVIADA: cliente onde está alocada. EM_ROTA: cliente de destino (NULL = volta ao pátio).
  cliente_id     INTEGER REFERENCES clientes (id),
  dispositivo_id TEXT    NOT NULL UNIQUE REFERENCES dispositivos (id),
  leituras_fora  INTEGER NOT NULL DEFAULT 0,
  atualizado_em  TEXT    NOT NULL,
  -- Furgão em que a bombona viaja (NULL fora de furgão).
  roteiro_id     INTEGER REFERENCES roteiros (id)
);

CREATE TABLE IF NOT EXISTS leituras (
  id             INTEGER PRIMARY KEY,
  bombona_id     INTEGER NOT NULL REFERENCES bombonas (id),
  dispositivo_id TEXT    NOT NULL REFERENCES dispositivos (id),
  lat            REAL    NOT NULL,
  lng            REAL    NOT NULL,
  precisao       REAL    NOT NULL DEFAULT 0,
  bateria        REAL    NOT NULL,
  registrado_em  TEXT    NOT NULL,
  dentro_cerca   INTEGER
);
CREATE INDEX IF NOT EXISTS leituras_bombona ON leituras (bombona_id, id);

CREATE TABLE IF NOT EXISTS movimentacoes (
  id          INTEGER PRIMARY KEY,
  bombona_id  INTEGER NOT NULL REFERENCES bombonas (id),
  tipo        TEXT    NOT NULL,
  cliente_id  INTEGER REFERENCES clientes (id),
  observacao  TEXT,
  litros      INTEGER,
  incidente   INTEGER NOT NULL DEFAULT 0,
  criado_em   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS alertas (
  id            INTEGER PRIMARY KEY,
  bombona_id    INTEGER NOT NULL REFERENCES bombonas (id),
  cliente_id    INTEGER REFERENCES clientes (id),
  tipo          TEXT    NOT NULL CHECK (tipo IN ('FORA_DA_AREA', 'EXTRAVIO', 'SEM_SINAL', 'BATERIA_BAIXA', 'COLETA_ABAIXO')),
  severidade    TEXT    NOT NULL CHECK (severidade IN ('INFO', 'AVISO', 'CRITICO')),
  mensagem      TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO', 'RESOLVIDO')),
  aberto_em     TEXT    NOT NULL,
  resolvido_em  TEXT,
  resolvido_por TEXT,
  resolucao     TEXT,
  -- RN14/RN15: reaberto na mesma saída da cerca depois de uma resolução manual; não conta como novo incidente.
  reaberto      INTEGER NOT NULL DEFAULT 0
);
-- RN12: no máximo um alerta aberto por tipo e por bombona (exceto COLETA_ABAIXO, que é do cliente).
DROP INDEX IF EXISTS alertas_um_aberto;
CREATE UNIQUE INDEX alertas_um_aberto ON alertas (bombona_id, tipo) WHERE status = 'ABERTO' AND tipo <> 'COLETA_ABAIXO';
-- RN18: no máximo um aviso de coleta abaixo do esperado aberto por cliente.
CREATE UNIQUE INDEX IF NOT EXISTS alertas_coleta_abaixo_cliente ON alertas (cliente_id) WHERE status = 'ABERTO' AND tipo = 'COLETA_ABAIXO';

-- RN19: no máximo um contrato ativo por cliente. dias_semana guarda "1,3,5".
CREATE TABLE IF NOT EXISTS contratos (
  id                INTEGER PRIMARY KEY,
  cliente_id        INTEGER NOT NULL REFERENCES clientes (id),
  quantidade        INTEGER NOT NULL CHECK (quantidade >= 1),
  frequencia        TEXT    NOT NULL CHECK (frequencia IN ('DIARIA', 'SEMANAL', 'QUINZENAL', 'MENSAL')),
  dias_semana       TEXT    NOT NULL DEFAULT '',
  dia_mes           INTEGER,
  inicio            TEXT    NOT NULL,
  situacao          TEXT    NOT NULL DEFAULT 'ATIVO' CHECK (situacao IN ('ATIVO', 'ENCERRADO')),
  retirada_pendente INTEGER NOT NULL DEFAULT 0,
  criado_em         TEXT    NOT NULL,
  atualizado_em     TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS contratos_um_ativo ON contratos (cliente_id) WHERE situacao = 'ATIVO';

CREATE TABLE IF NOT EXISTS operacao (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  data       TEXT    NOT NULL,
  fase       TEXT    NOT NULL CHECK (fase IN ('MANHA', 'ROTAS', 'FIM')),
  fase_desde TEXT    NOT NULL,
  pausado    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS paradas (
  id          INTEGER PRIMARY KEY,
  data        TEXT    NOT NULL,
  roteiro_id  INTEGER REFERENCES roteiros (id),
  ordem       INTEGER,
  cliente_id  INTEGER NOT NULL REFERENCES clientes (id),
  contrato_id INTEGER REFERENCES contratos (id),
  motivo      TEXT    NOT NULL CHECK (motivo IN ('COLETA', 'RETIRADA')),
  vazias      INTEGER NOT NULL,
  demanda     INTEGER NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('PENDENTE', 'FEITA', 'NAO_ATENDIDA')),
  resultado   TEXT,
  feita_em    TEXT
);

-- Canal de controle da demonstração: o painel pede um cenário e o simulador executa.
CREATE TABLE IF NOT EXISTS simulacao_comandos (
  id            INTEGER PRIMARY KEY,
  bombona_id    INTEGER NOT NULL REFERENCES bombonas (id),
  tipo          TEXT    NOT NULL,
  criado_em     TEXT    NOT NULL,
  consumido_em  TEXT
);
`;

/** Versão do esquema; um banco mais antigo é descartado e recriado (os dados são de demonstração). */
export const VERSAO_ESQUEMA = 3;

function descartarSeDesatualizado(caminho: string) {
  if (caminho === ':memory:' || !fs.existsSync(caminho)) return;
  const existente = new DatabaseSync(caminho);
  const tabelas = (existente.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
  const versao = (existente.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  existente.close();
  if (tabelas === 0 || versao >= VERSAO_ESQUEMA) return;
  for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(caminho + sufixo, { force: true });
}

export function abrirBanco(caminho: string): Banco {
  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(caminho), { recursive: true });
  descartarSeDesatualizado(caminho);
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);
  const versao = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (versao < VERSAO_ESQUEMA) db.exec(`PRAGMA user_version = ${VERSAO_ESQUEMA}`);
  return db;
}

/** Executa `fn` numa transação; desfaz tudo se lançar erro. */
export function transacao<T>(db: Banco, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}

export const agoraIso = () => new Date().toISOString();
