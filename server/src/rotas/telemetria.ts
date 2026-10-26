import { Router } from 'express';
import type { Contexto } from '../contexto.ts';
import { processarLeitura, type Leitura } from '../regras.ts';

/** Tolerância para relógio adiantado do dispositivo. */
const FUTURO_MAXIMO_MS = 5 * 60_000;

const ehNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Valida o payload do contrato do dispositivo (docs/contrato-dispositivo.md). */
export function validarLeitura(corpo: unknown, agora = Date.now()): { leitura: Leitura } | { erro: string } {
  if (typeof corpo !== 'object' || corpo === null) return { erro: 'Corpo deve ser um objeto JSON' };
  const { lat, lng, precisao = 0, bateria, registradoEm } = corpo as Record<string, unknown>;
  if (!ehNumero(lat) || lat < -90 || lat > 90) return { erro: 'lat inválida' };
  if (!ehNumero(lng) || lng < -180 || lng > 180) return { erro: 'lng inválida' };
  if (!ehNumero(bateria) || bateria < 0 || bateria > 100) return { erro: 'bateria deve estar entre 0 e 100' };
  if (!ehNumero(precisao) || precisao < 0) return { erro: 'precisao inválida' };

  let quando = new Date(agora);
  if (registradoEm !== undefined) {
    quando = new Date(typeof registradoEm === 'string' ? registradoEm : NaN);
    if (Number.isNaN(quando.getTime())) return { erro: 'registradoEm deve ser uma data ISO 8601' };
    if (quando.getTime() > agora + FUTURO_MAXIMO_MS) return { erro: 'registradoEm está no futuro' };
  }
  // Precisão absurda não pode "esticar" a cerca indefinidamente.
  return { leitura: { lat, lng, bateria, precisao: Math.min(precisao, 500), registradoEm: quando.toISOString() } };
}

export function rotasDeTelemetria(ctx: Contexto) {
  const r = Router();

  // RN16: o dispositivo se identifica pelo token.
  r.post('/telemetria', (req, res) => {
    const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const dispositivo = token
      ? (ctx.db.prepare('SELECT id FROM dispositivos WHERE token = ?').get(token) as { id: string } | undefined)
      : undefined;
    if (!dispositivo) return void res.status(401).json({ erro: 'Dispositivo não autorizado' });

    const validacao = validarLeitura(req.body);
    if ('erro' in validacao) return void res.status(400).json(validacao);

    const { bombona, atrasada } = processarLeitura(ctx, dispositivo.id, validacao.leitura);
    res.status(202).json({ recebido: true, atrasada, status: bombona.status });
  });

  r.get('/eventos', (req, res) => ctx.eventos.conectar(req, res));

  return r;
}
