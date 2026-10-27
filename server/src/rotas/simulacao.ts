import { Router } from 'express';
import { destino, linhaBombonaPorCodigo, localEsperado, type LinhaBombona } from '../consultas.ts';
import type { Contexto } from '../contexto.ts';
import { agoraIso, transacao } from '../db.ts';

export const CENARIOS = ['VENDA', 'DEVOLUCAO', 'SEM_SINAL', 'BATERIA_FRACA'] as const;

/**
 * Canal de controle da DEMONSTRAÇÃO. Não faz parte do produto: o painel pede um cenário
 * e o simulador (que finge ser o hardware) busca o pedido aqui.
 */
export function rotasDeSimulacao(ctx: Contexto) {
  const r = Router();
  const { db, config } = ctx;

  r.post('/simulacao/comandos', (req, res) => {
    const tipo = req.body?.tipo;
    if (!CENARIOS.includes(tipo)) return void res.status(400).json({ erro: `tipo deve ser um de: ${CENARIOS.join(', ')}` });
    const b = linhaBombonaPorCodigo(db, String(req.body?.bombona ?? ''));
    if (!b) return void res.status(404).json({ erro: 'Bombona não encontrada' });
    const { lastInsertRowid } = db
      .prepare('INSERT INTO simulacao_comandos (bombona_id, tipo, criado_em) VALUES (?, ?, ?)')
      .run(b.id, tipo, agoraIso());
    res.status(201).json({ id: Number(lastInsertRowid), bombona: b.codigo, tipo });
  });

  r.get('/simulacao/estado', (req, res) => {
    if (req.get('authorization') !== `Bearer ${config.tokenSimulador}`) return void res.status(401).json({ erro: 'Não autorizado' });

    const bombonas = db
      .prepare(
        `SELECT b.*, d.token, d.bateria, d.lat, d.lng, d.ultimo_sinal,
                c.nome AS cliente_nome, c.cidade AS cliente_cidade, c.lat AS cliente_lat, c.lng AS cliente_lng, c.raio_m AS cliente_raio
         FROM bombonas b JOIN dispositivos d ON d.id = b.dispositivo_id LEFT JOIN clientes c ON c.id = b.cliente_id
         ORDER BY b.codigo`,
      )
      .all() as Array<LinhaBombona & { token: string }>;

    const comandos = transacao(db, () =>
      db
        .prepare(
          `UPDATE simulacao_comandos SET consumido_em = ? WHERE consumido_em IS NULL
           RETURNING id, tipo, (SELECT codigo FROM bombonas WHERE id = bombona_id) AS bombona`,
        )
        .all(agoraIso()),
    );

    res.json({
      dispositivos: bombonas.map((b) => ({
        dispositivoId: b.dispositivo_id,
        token: b.token,
        bombona: b.codigo,
        status: b.status,
        posicao: b.lat === null || b.lng === null ? null : { lat: b.lat, lng: b.lng },
        bateria: b.bateria,
        // Onde o "caminhão" leva a bombona em rota, ou onde ela deveria estar parada.
        alvo: destino(b, config) ?? localEsperado(b, config),
      })),
      comandos,
    });
  });

  return r;
}
