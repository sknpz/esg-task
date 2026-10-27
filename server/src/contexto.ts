import type { Config } from './config.ts';
import type { Banco } from './db.ts';

/** Dependências compartilhadas pelas rotas e pelos serviços. */
export type Contexto = {
  db: Banco;
  config: Config;
};
