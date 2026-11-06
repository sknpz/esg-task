import { Router } from 'express';
import type { Contexto } from '../contexto.ts';
import { dataOperacao } from '../contratos.ts';
import { continuar, estadoOperacao, pausar, roteirosDoDia } from '../operacao.ts';

/** Relógio da operação e furgões do dia. */
export function rotasDeRoteiros(ctx: Contexto) {
  const r = Router();

  r.get('/operacao', (_req, res) => {
    res.json(estadoOperacao(ctx));
  });

  r.post('/operacao/pausar', (_req, res) => {
    res.json(pausar(ctx));
  });

  r.post('/operacao/continuar', (_req, res) => {
    res.json(continuar(ctx));
  });

  r.get('/roteiros', (req, res) => {
    const data = req.query.data === undefined ? dataOperacao(ctx) : String(req.query.data);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return void res.status(400).json({ erro: 'data deve estar no formato AAAA-MM-DD' });
    res.json(roteirosDoDia(ctx.db, ctx.config, data));
  });

  return r;
}
