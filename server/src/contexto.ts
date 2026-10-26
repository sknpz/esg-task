import type { Config } from './config.ts';
import type { Banco } from './db.ts';
import type { HubDeEventos } from './eventos.ts';

/** Dependências compartilhadas pelas rotas e pelos serviços. */
export type Contexto = {
  db: Banco;
  config: Config;
  eventos: HubDeEventos;
};
