import { Router, type Response } from 'express';
import type { Contexto } from '../contexto.ts';
import { coletar, enviarParaCliente, ErroDeNegocio, resolverAlerta } from '../operacoes.ts';

/** Converte erros de negócio em resposta HTTP; o resto segue para o tratador global. */
function responder(res: Response, acao: () => unknown, status = 200) {
  try {
    res.status(status).json(acao());
  } catch (erro) {
    if (!(erro instanceof ErroDeNegocio)) throw erro;
    res.status(erro.status).json({ erro: erro.message });
  }
}

export function rotasDeOperacao(ctx: Contexto) {
  const r = Router();

  r.post('/bombonas/:codigo/entrega', (req, res) => {
    const clienteId = Number(req.body?.clienteId);
    if (!Number.isInteger(clienteId)) return void res.status(400).json({ erro: 'clienteId é obrigatório' });
    responder(res, () => enviarParaCliente(ctx, req.params.codigo, clienteId, req.body?.observacao));
  });

  r.post('/bombonas/:codigo/coleta', (req, res) => {
    responder(res, () => coletar(ctx, req.params.codigo, req.body?.observacao));
  });

  r.post('/alertas/:id/resolver', (req, res) => {
    responder(res, () => resolverAlerta(ctx, Number(req.params.id), String(req.body?.observacao ?? '')));
  });

  return r;
}
