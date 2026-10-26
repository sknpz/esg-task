import type { AddressInfo } from 'node:net';
import { criarApp } from '../src/app.ts';
import { carregarConfig, type Config } from '../src/config.ts';
import type { Contexto } from '../src/contexto.ts';
import { abrirBanco } from '../src/db.ts';
import { popularSeVazio } from '../src/seed.ts';

/** Contexto com banco em memória já populado. */
export function criarContexto(ajustes: Partial<Config> = {}): Contexto {
  const config = { ...carregarConfig(), caminhoBanco: ':memory:', ...ajustes };
  const db = abrirBanco(config.caminhoBanco);
  popularSeVazio(db, config);
  return { db, config };
}

/** Sobe a API numa porta livre e devolve a URL base e uma função para encerrar. */
export async function subirApi(ctx: Contexto) {
  const servidor = criarApp(ctx).listen(0);
  await new Promise((ok) => servidor.once('listening', ok));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api`,
    fechar: () => new Promise((ok) => servidor.close(ok)),
  };
}
