import { abrirAlerta, resolverAlertasDaBombona, temAlertaAberto } from './alertas.ts';
import { bombonaDto, destino, linhaBombonaPorId, localEsperado } from './consultas.ts';
import type { Contexto } from './contexto.ts';
import { transacao } from './db.ts';
import { dentroDaCerca, distanciaM } from './geo.ts';

export type Leitura = { lat: number; lng: number; precisao: number; bateria: number; registradoEm: string };

/** Leituras fora da cerca necessárias para abrir o alerta (RN07). */
const LEITURAS_PARA_CONFIRMAR = 2;

const km = (metros: number) => `${(metros / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;

/**
 * Aplica as regras de negócio a uma leitura recebida de um dispositivo.
 * Tudo roda numa transação e os eventos só são emitidos depois do commit.
 */
export function processarLeitura(ctx: Contexto, dispositivoId: string, leitura: Leitura) {
  const { db, config } = ctx;
  const alertas: unknown[] = [];
  const { id: bombonaId } = db.prepare('SELECT id FROM bombonas WHERE dispositivo_id = ?').get(dispositivoId) as { id: number };
  const em = leitura.registradoEm;

  const gravarLeitura = (dentroCerca: boolean | null) =>
    db
      .prepare(
        `INSERT INTO leituras (bombona_id, dispositivo_id, lat, lng, precisao, bateria, registrado_em, dentro_cerca)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(bombonaId, dispositivoId, leitura.lat, leitura.lng, leitura.precisao, leitura.bateria, em, dentroCerca === null ? null : Number(dentroCerca));

  const resultado = transacao(db, () => {
    const b = linhaBombonaPorId(db, bombonaId)!;
    const posicao = { lat: leitura.lat, lng: leitura.lng };

    // Leitura atrasada (dispositivo descarregando buffer): vai para o histórico, mas não muda o estado.
    if (b.ultimo_sinal && em < b.ultimo_sinal) {
      gravarLeitura(null);
      return { atrasada: true };
    }

    db.prepare('UPDATE dispositivos SET bateria = ?, ultimo_sinal = ?, lat = ?, lng = ? WHERE id = ?').run(
      leitura.bateria,
      em,
      leitura.lat,
      leitura.lng,
      dispositivoId,
    );

    // RN10: o sinal voltou.
    alertas.push(...resolverAlertasDaBombona(db, b.id, ['SEM_SINAL'], { por: 'SISTEMA', texto: 'Sinal restabelecido', em }));

    // RN11: bateria.
    if (leitura.bateria < config.bateriaMinima) {
      alertas.push(
        abrirAlerta(db, {
          bombonaId: b.id,
          clienteId: b.cliente_id,
          tipo: 'BATERIA_BAIXA',
          severidade: 'INFO',
          mensagem: `Bateria do rastreador em ${Math.round(leitura.bateria)}%`,
          em,
        }),
      );
    } else if (leitura.bateria >= config.bateriaRecuperada) {
      alertas.push(...resolverAlertasDaBombona(db, b.id, ['BATERIA_BAIXA'], { por: 'SISTEMA', texto: 'Bateria trocada ou recarregada', em }));
    }

    let novoStatus = b.status;
    let leiturasFora = 0;
    let dentro: boolean | null = null;

    if (b.status === 'EM_ROTA') {
      // RN13: em rota não há cerca. RN04: chegada ao destino conclui a movimentação.
      const alvo = destino(b, config)!;
      if (dentroDaCerca(posicao, alvo, alvo.raioM, leitura.precisao)) {
        novoStatus = b.cliente_id === null ? 'PATIO' : 'EM_CLIENTE';
        db.prepare('INSERT INTO movimentacoes (bombona_id, tipo, cliente_id, observacao, criado_em) VALUES (?, ?, ?, ?, ?)').run(
          b.id,
          b.cliente_id === null ? 'RETORNO_AO_PATIO' : 'ENTREGA_CONCLUIDA',
          b.cliente_id,
          'Confirmada automaticamente pela chegada do rastreador',
          em,
        );
      }
    } else {
      const esperado = localEsperado(b, config)!;
      dentro = dentroDaCerca(posicao, esperado, esperado.raioM, leitura.precisao);

      if (dentro) {
        // RN09: voltou para o lugar.
        alertas.push(
          ...resolverAlertasDaBombona(db, b.id, ['FORA_DA_AREA', 'EXTRAVIO'], {
            por: 'SISTEMA',
            texto: `Bombona voltou para ${esperado.nome}`,
            em,
          }),
        );
        if (b.status === 'EXTRAVIADA') novoStatus = b.cliente_id === null ? 'PATIO' : 'EM_CLIENTE';
      } else {
        leiturasFora = b.leituras_fora + 1;
        const distancia = distanciaM(posicao, esperado);
        // RN07: só confirma depois de leituras consecutivas fora.
        if (leiturasFora >= LEITURAS_PARA_CONFIRMAR) {
          alertas.push(
            abrirAlerta(db, {
              bombonaId: b.id,
              clienteId: b.cliente_id,
              tipo: 'FORA_DA_AREA',
              severidade: 'AVISO',
              mensagem: `Saiu da cerca de ${esperado.nome} (${Math.round(distancia)} m do ponto)`,
              em,
            }),
          );
          // RN08: longe demais vira extravio.
          if (distancia > config.extravioMetros) {
            novoStatus = 'EXTRAVIADA';
            alertas.push(
              abrirAlerta(db, {
                bombonaId: b.id,
                clienteId: b.cliente_id,
                tipo: 'EXTRAVIO',
                severidade: 'CRITICO',
                mensagem: `A ${km(distancia)} de ${esperado.nome}: possível venda ou descarte`,
                em,
              }),
            );
          }
        }
      }
    }

    db.prepare('UPDATE bombonas SET status = ?, leituras_fora = ?, atualizado_em = ? WHERE id = ?').run(
      novoStatus,
      leiturasFora,
      new Date().toISOString(),
      b.id,
    );
    gravarLeitura(dentro);
    return { atrasada: false };
  });

  const bombona = bombonaDto(db, config, bombonaId)!;
  const alteracoes = alertas.filter(Boolean);
  ctx.eventos.emitir({ tipo: 'bombona', dados: bombona });
  for (const alerta of alteracoes) ctx.eventos.emitir({ tipo: 'alerta', dados: alerta });
  return { ...resultado, bombona, alertas: alteracoes };
}

/** RN10: abre SEM_SINAL para dispositivos calados há mais tempo que o limite. */
export function verificarSemSinal(ctx: Contexto, agora = Date.now()) {
  const { db, config } = ctx;
  const limite = new Date(agora - config.semSinalSegundos * 1000).toISOString();
  const caladas = db
    .prepare(
      `SELECT b.id, b.cliente_id, d.ultimo_sinal
       FROM bombonas b JOIN dispositivos d ON d.id = b.dispositivo_id
       WHERE d.ultimo_sinal < ?`,
    )
    .all(limite) as Array<{ id: number; cliente_id: number | null; ultimo_sinal: string }>;

  const abertos = [];
  for (const b of caladas) {
    if (temAlertaAberto(db, b.id, 'SEM_SINAL')) continue;
    const alerta = abrirAlerta(db, {
      bombonaId: b.id,
      clienteId: b.cliente_id,
      tipo: 'SEM_SINAL',
      severidade: 'AVISO',
      mensagem: `Rastreador sem sinal desde ${new Date(b.ultimo_sinal).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      em: new Date(agora).toISOString(),
    });
    if (!alerta) continue;
    abertos.push(alerta);
    ctx.eventos.emitir({ tipo: 'alerta', dados: alerta });
    ctx.eventos.emitir({ tipo: 'bombona', dados: bombonaDto(db, config, b.id) });
  }
  return abertos;
}
