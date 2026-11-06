import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { abrirBanco, VERSAO_ESQUEMA } from '../src/db.ts';

const arquivoTemp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'esg-')), 'bombonas.db');

it('recria um banco de versão antiga e aceita o esquema novo', () => {
  const arquivo = arquivoTemp();
  const antigo = new DatabaseSync(arquivo);
  antigo.exec(`CREATE TABLE alertas (id INTEGER PRIMARY KEY, tipo TEXT CHECK (tipo IN ('FORA_DA_AREA')));
               CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT); INSERT INTO clientes (nome) VALUES ('velho');`);
  antigo.close();

  const db = abrirBanco(arquivo);
  assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, VERSAO_ESQUEMA);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM clientes').get() as any).n, 0);
  const cols = (db.prepare('PRAGMA table_info(movimentacoes)').all() as any[]).map((c) => c.name);
  assert.ok(cols.includes('litros'));
  db.close();
});

it('não apaga um banco que já está na versão atual', () => {
  const arquivo = arquivoTemp();
  const db = abrirBanco(arquivo);
  db.exec(`INSERT INTO clientes (nome, tipo, cidade, endereco, lat, lng) VALUES ('novo', 'x', 'y', 'z', 0, 0)`);
  db.close();

  const reaberto = abrirBanco(arquivo);
  assert.equal((reaberto.prepare('SELECT COUNT(*) AS n FROM clientes').get() as any).n, 1);
  reaberto.close();
});
