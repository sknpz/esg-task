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

CREATE TABLE IF NOT EXISTS bombonas (
  id             INTEGER PRIMARY KEY,
  codigo         TEXT    NOT NULL UNIQUE,
  capacidade_l   INTEGER NOT NULL,
  status         TEXT    NOT NULL CHECK (status IN ('PATIO', 'EM_ROTA', 'EM_CLIENTE', 'EXTRAVIADA')),
  -- EM_CLIENTE/EXTRAVIADA: cliente onde está alocada. EM_ROTA: cliente de destino (NULL = volta ao pátio).
  cliente_id     INTEGER REFERENCES clientes (id),
  dispositivo_id TEXT    NOT NULL UNIQUE REFERENCES dispositivos (id),
  leituras_fora  INTEGER NOT NULL DEFAULT 0,
  atualizado_em  TEXT    NOT NULL
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
  criado_em   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS alertas (
  id            INTEGER PRIMARY KEY,
  bombona_id    INTEGER NOT NULL REFERENCES bombonas (id),
  cliente_id    INTEGER REFERENCES clientes (id),
  tipo          TEXT    NOT NULL CHECK (tipo IN ('FORA_DA_AREA', 'EXTRAVIO', 'SEM_SINAL', 'BATERIA_BAIXA')),
  severidade    TEXT    NOT NULL CHECK (severidade IN ('INFO', 'AVISO', 'CRITICO')),
  mensagem      TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO', 'RESOLVIDO')),
  aberto_em     TEXT    NOT NULL,
  resolvido_em  TEXT,
  resolvido_por TEXT,
  resolucao     TEXT
);
-- RN12: no máximo um alerta aberto por tipo e por bombona.
CREATE UNIQUE INDEX IF NOT EXISTS alertas_um_aberto ON alertas (bombona_id, tipo) WHERE status = 'ABERTO';

-- Canal de controle da demonstração: o painel pede um cenário e o simulador executa.
CREATE TABLE IF NOT EXISTS simulacao_comandos (
  id            INTEGER PRIMARY KEY,
  bombona_id    INTEGER NOT NULL REFERENCES bombonas (id),
  tipo          TEXT    NOT NULL,
  criado_em     TEXT    NOT NULL,
  consumido_em  TEXT
);
`;

export function abrirBanco(caminho: string): Banco {
  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);
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
