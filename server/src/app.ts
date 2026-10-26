import express, { type ErrorRequestHandler } from 'express';
import type { Contexto } from './contexto.ts';
import { rotasDeConsulta } from './rotas/consulta.ts';
import { rotasDeOperacao } from './rotas/operacao.ts';
import { rotasDeSimulacao } from './rotas/simulacao.ts';
import { rotasDeTelemetria } from './rotas/telemetria.ts';

export function criarApp(ctx: Contexto) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.use('/api', rotasDeConsulta(ctx));
  app.use('/api', rotasDeTelemetria(ctx));
  app.use('/api', rotasDeOperacao(ctx));
  if (ctx.config.simulacaoAtiva) app.use('/api', rotasDeSimulacao(ctx));

  app.use('/api', (_req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada' });
  });

  const tratarErro: ErrorRequestHandler = (erro, _req, res, _next) => {
    if (erro?.type === 'entity.parse.failed') return void res.status(400).json({ erro: 'JSON inválido' });
    console.error(erro);
    res.status(500).json({ erro: 'Erro interno' });
  };
  app.use(tratarErro);

  return app;
}
