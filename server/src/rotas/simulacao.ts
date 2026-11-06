import { Router, type RequestHandler } from 'express';
import type { Config } from '../config.ts';
import { bombonasProcuradas, destino, linhaBombonaPorCodigo, localEsperado, type LinhaBombona } from '../consultas.ts';
import type { Contexto } from '../contexto.ts';
import { caiNaData, proximoDiaOperacao } from '../calendario.ts';
import { dataOperacao, regraDoContrato } from '../contratos.ts';
import { agoraIso, transacao, type Banco } from '../db.ts';
import { litrosEsperados } from '../rendimento.ts';

export const CENARIOS = ['VENDA', 'DEVOLUCAO', 'SEM_SINAL', 'BATERIA_FRACA', 'VENDA_SILENCIOSA'] as const;

/**
 * Bombona para a venda com rastreador arrancado quando o painel não escolhe: uma em cliente, fora de furgão e que
 * ainda não foi "vendida" assim desde que foi deixada lá. Prefere cliente com coleta no próximo dia de operação,
 * para a parada que não a acha (RN22) vir logo. Sem nenhuma em cliente, null.
 */
function escolherParaVendaSilenciosa(db: Banco, hoje: string): { id: number; codigo: string } | null {
  const candidatas = db
    .prepare(
      `SELECT b.id, b.codigo, b.cliente_id AS clienteId FROM bombonas b
       WHERE b.status = 'EM_CLIENTE' AND b.roteiro_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM simulacao_comandos s
           WHERE s.bombona_id = b.id AND s.tipo = 'VENDA_SILENCIOSA'
             AND s.criado_em >= COALESCE((SELECT MAX(e.criado_em) FROM movimentacoes e
                                          WHERE e.bombona_id = b.id AND e.tipo = 'ENTREGA_CONCLUIDA'), ''))
       ORDER BY b.codigo`,
    )
    .all() as Array<{ id: number; codigo: string; clienteId: number }>;
  const proximo = proximoDiaOperacao(hoje);
  const contratos = db
    .prepare(
      `SELECT cliente_id AS clienteId, frequencia, dias_semana AS diasSemana, dia_mes AS diaMes, inicio
       FROM contratos WHERE situacao = 'ATIVO'`,
    )
    .all() as Array<Parameters<typeof regraDoContrato>[0] & { clienteId: number }>;
  const comColeta = new Set(contratos.filter((k) => caiNaData(regraDoContrato(k), proximo)).map((k) => k.clienteId));
  const preferidas = candidatas.filter((b) => comColeta.has(b.clienteId));
  const lista = preferidas.length ? preferidas : candidatas;
  return lista[Math.floor(Math.random() * lista.length)] ?? null;
}

/** Só o simulador (que finge ser o hardware e os furgões) passa: `Authorization: Bearer <tokenSimulador>`, senão 401. */
export function exigirTokenSimulador(config: Config): RequestHandler {
  return (req, res, next) => {
    if (req.get('authorization') !== `Bearer ${config.tokenSimulador}`) return void res.status(401).json({ erro: 'Não autorizado' });
    next();
  };
}

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
    const pedida = req.body?.bombona;
    // Venda com rastreador arrancado: a bombona é opcional, o servidor escolhe uma boa para a demonstração.
    const escolher = tipo === 'VENDA_SILENCIOSA' && (pedida === undefined || pedida === null || pedida === '');
    const b = escolher ? escolherParaVendaSilenciosa(db, dataOperacao(ctx)) : linhaBombonaPorCodigo(db, String(pedida ?? ''));
    if (!b && escolher) return void res.status(409).json({ erro: 'Nenhuma bombona em cliente para vender' });
    if (!b) return void res.status(404).json({ erro: 'Bombona não encontrada' });
    const { lastInsertRowid } = db
      .prepare('INSERT INTO simulacao_comandos (bombona_id, tipo, criado_em) VALUES (?, ?, ?)')
      .run(b.id, tipo, agoraIso());
    res.status(201).json({ id: Number(lastInsertRowid), bombona: b.codigo, tipo });
  });

  r.get('/simulacao/estado', exigirTokenSimulador(config), (_req, res) => {
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
    // As bombonas que a troca vai procurar no cliente (RN21/RN22); só interessam nas paradas por fazer.
    const procuradas = bombonasProcuradas(db);
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
          capacidades: p.status === 'PENDENTE' ? procuradas(p.clienteId).map((b) => b.capacidade_l) : [],
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
