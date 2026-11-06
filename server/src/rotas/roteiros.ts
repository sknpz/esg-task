import { Router, type Response } from 'express';
import type { Contexto } from '../contexto.ts';
import { dataOperacao } from '../contratos.ts';
import {
  concluirRoteiro,
  continuar,
  definirVelocidade,
  estadoOperacao,
  pausar,
  registrarPosicao,
  registrarTrajeto,
  registrarTroca,
  roteirosDoDia,
} from '../operacao.ts';
import { ErroDeNegocio } from '../operacoes.ts';
import { resetarSimulacao } from '../reset.ts';
import { exigirRodadaAtual, exigirTokenSimulador } from './simulacao.ts';

/** Converte erros de negócio em resposta HTTP; o resto segue para o tratador global. */
function responder(res: Response, acao: () => unknown, status = 200) {
  try {
    res.status(status).json(acao());
  } catch (erro) {
    if (!(erro instanceof ErroDeNegocio)) throw erro;
    res.status(erro.status).json({ erro: erro.message });
  }
}

/** Relógio da operação e furgões do dia. */
export function rotasDeRoteiros(ctx: Contexto) {
  const r = Router();

  // Quem move o furgão é o simulador: as rotas de escrita dos roteiros exigem o token dele.
  const soSimulador = exigirTokenSimulador(ctx.config);
  const rodadaAtual = exigirRodadaAtual(ctx);

  r.get('/operacao', (_req, res) => {
    res.json(estadoOperacao(ctx));
  });

  r.post('/operacao/pausar', (_req, res) => {
    res.json(pausar(ctx));
  });

  r.post('/operacao/continuar', (_req, res) => {
    res.json(continuar(ctx));
  });

  r.post('/operacao/velocidade', (req, res) => {
    const velocidade = req.body?.velocidade;
    if (velocidade !== 1 && velocidade !== 2) return void res.status(400).json({ erro: 'velocidade deve ser 1 ou 2' });
    res.json(definirVelocidade(ctx, velocidade));
  });

  r.post('/operacao/reset', (_req, res) => {
    res.json(resetarSimulacao(ctx));
  });

  r.get('/roteiros', (req, res) => {
    const data = req.query.data === undefined ? dataOperacao(ctx) : String(req.query.data);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return void res.status(400).json({ erro: 'data deve estar no formato AAAA-MM-DD' });
    res.json(roteirosDoDia(ctx.db, ctx.config, data));
  });

  r.post('/roteiros/:id/trajeto', soSimulador, rodadaAtual, (req, res) => {
    responder(res, () => registrarTrajeto(ctx, Number(req.params.id), req.body));
  });

  r.post('/roteiros/:id/posicao', soSimulador, rodadaAtual, (req, res) => {
    responder(res, () => registrarPosicao(ctx, Number(req.params.id), req.body));
  });

  r.post('/roteiros/:id/paradas/:paradaId/troca', soSimulador, rodadaAtual, (req, res) => {
    responder(res, () => registrarTroca(ctx, Number(req.params.id), Number(req.params.paradaId), req.body));
  });

  r.post('/roteiros/:id/concluir', soSimulador, rodadaAtual, (req, res) => {
    responder(res, () => concluirRoteiro(ctx, Number(req.params.id)));
  });

  return r;
}
