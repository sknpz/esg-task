import { Router } from 'express';
import {
  detalheBombona,
  indicadores,
  linhaBombonaPorCodigo,
  listarAlertas,
  listarBombonas,
  listarClientes,
  trilha,
} from '../consultas.ts';
import type { Contexto } from '../contexto.ts';

export function rotasDeConsulta({ db, config }: Contexto) {
  const r = Router();

  r.get('/saude', (_req, res) => {
    res.json({ ok: true, agora: new Date().toISOString() });
  });

  r.get('/configuracao', (_req, res) => {
    res.json({
      patio: config.patio,
      extravioMetros: config.extravioMetros,
      semSinalSegundos: config.semSinalSegundos,
      bateriaMinima: config.bateriaMinima,
    });
  });

  r.get('/indicadores', (_req, res) => {
    res.json(indicadores(db));
  });

  r.get('/bombonas', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json(listarBombonas(db, config, status));
  });

  r.get('/bombonas/:codigo', (req, res) => {
    const detalhe = detalheBombona(db, config, req.params.codigo);
    if (!detalhe) return void res.status(404).json({ erro: 'Bombona não encontrada' });
    res.json(detalhe);
  });

  r.get('/bombonas/:codigo/trilha', (req, res) => {
    const linha = linhaBombonaPorCodigo(db, req.params.codigo);
    if (!linha) return void res.status(404).json({ erro: 'Bombona não encontrada' });
    const limite = Math.min(Number(req.query.limite) || 200, 2000);
    res.json(trilha(db, linha.id, limite));
  });

  r.get('/clientes', (_req, res) => {
    res.json(listarClientes(db));
  });

  r.get('/alertas', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json(listarAlertas(db, { status }));
  });

  return r;
}
