import { Router } from 'express';
import { destino, linhaBombonaPorCodigo, localEsperado, type LinhaBombona } from '../consultas.ts';
import type { Contexto } from '../contexto.ts';
import { dataOperacao } from '../contratos.ts';
import { agoraIso, transacao } from '../db.ts';
import { litrosEsperados } from '../rendimento.ts';

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

    const pausado = db.prepare('SELECT pausado FROM operacao WHERE id = 1').get() as { pausado: number } | undefined;
    const operacao = { data: dataOperacao(ctx), pausado: pausado?.pausado === 1 };

    // Furgões na rua: o simulador faz as paradas e gera os litros em torno do esperado de cada cliente.
    const paradasDo = db.prepare(
      `SELECT p.id, p.ordem, p.status, p.cliente_id AS clienteId, c.nome, c.lat, c.lng
       FROM paradas p JOIN clientes c ON c.id = p.cliente_id WHERE p.roteiro_id = ? ORDER BY p.ordem`,
    );
    // As bombonas que a troca vai procurar no cliente (as mesmas da RN21/RN22).
    const capacidadesDo = db.prepare(
      "SELECT capacidade_l FROM bombonas WHERE cliente_id = ? AND status IN ('EM_CLIENTE', 'EXTRAVIADA') AND roteiro_id IS NULL ORDER BY codigo",
    );
    const noFurgao = db.prepare('SELECT codigo FROM bombonas WHERE roteiro_id = ? ORDER BY codigo');
    const emAndamento = db
      .prepare("SELECT id, numero FROM roteiros WHERE status = 'EM_ANDAMENTO' ORDER BY data, numero")
      .all() as Array<{ id: number; numero: number }>;
    const roteiros = emAndamento.map((r) => ({
      id: r.id,
      numero: r.numero,
      paradas: (paradasDo.all(r.id) as Array<{ id: number; ordem: number; status: string; clienteId: number; nome: string; lat: number; lng: number }>).map(
        (p) => ({
          ...p,
          litrosEsperados: litrosEsperados(db, p.clienteId, config.coletaHistoricoN),
          capacidades: (capacidadesDo.all(p.clienteId) as Array<{ capacidade_l: number }>).map((b) => b.capacidade_l),
        }),
      ),
      bombonas: (noFurgao.all(r.id) as Array<{ codigo: string }>).map((b) => b.codigo),
    }));

    res.json({
      operacao,
      roteiros,
      dispositivos: bombonas.map((b) => ({
        dispositivoId: b.dispositivo_id,
        token: b.token,
        bombona: b.codigo,
        status: b.status,
        posicao: b.lat === null || b.lng === null ? null : { lat: b.lat, lng: b.lng },
        bateria: b.bateria,
        // Onde o "furgão" leva a bombona em rota, ou onde ela deveria estar parada.
        alvo: destino(b, config) ?? localEsperado(b, config),
        roteiroId: b.roteiro_id,
        clienteId: b.cliente_id,
      })),
      comandos,
    });
  });

  return r;
}
