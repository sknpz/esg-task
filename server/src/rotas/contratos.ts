import { Router, type Response } from 'express';
import type { Contexto } from '../contexto.ts';
import { contratoPorId, criarContrato, dataOperacao, editarContrato, listarContratos } from '../contratos.ts';
import { ErroDeNegocio } from '../operacoes.ts';

/** Converte erros de negócio em resposta HTTP; o resto segue para o tratador global. */
function responder(res: Response, acao: () => unknown, status = 200) {
  try {
    res.status(status).json(acao());
  } catch (erro) {
    if (!(erro instanceof ErroDeNegocio)) throw erro;
    res.status(erro.status).json({ erro: erro.message });
  }
}

export function rotasDeContratos(ctx: Contexto) {
  const r = Router();

  r.get('/contratos', (_req, res) => {
    res.json(listarContratos(ctx.db, dataOperacao(ctx)));
  });

  r.get('/contratos/:id', (req, res) => {
    responder(res, () => {
      const c = contratoPorId(ctx.db, Number(req.params.id), dataOperacao(ctx));
      if (!c) throw new ErroDeNegocio(404, 'Contrato não encontrado');
      return c;
    });
  });

  r.post('/contratos', (req, res) => responder(res, () => criarContrato(ctx, req.body), 201));

  r.put('/contratos/:id', (req, res) => responder(res, () => editarContrato(ctx, Number(req.params.id), req.body)));

  return r;
}
