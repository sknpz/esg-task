import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { criarContrato } from '../src/contratos.ts';
import type { Evento } from '../src/eventos.ts';
import { avancarOperacao, continuar, definirModo, definirVelocidade, estadoOperacao } from '../src/operacao.ts';
import { registrarTroca } from '../src/operacao.ts';
import { resetarSimulacao } from '../src/reset.ts';
import { criarContexto, subirApi } from './apoio.ts';

const TABELAS = ['clientes', 'contratos', 'bombonas', 'dispositivos', 'alertas', 'movimentacoes', 'leituras', 'roteiros', 'paradas', 'simulacao_comandos'];
const contar = (ctx: ReturnType<typeof criarContexto>, tabela: string) =>
  (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;

/** Suja o banco: contrato novo, furgões na rua e uma troca feita. */
function sujar(ctx: ReturnType<typeof criarContexto>) {
  continuar(ctx);
  definirVelocidade(ctx, 2);
  definirModo(ctx, 'DEMO');
  criarContrato(ctx, { clienteId: 50, quantidade: 1, frequencia: 'DIARIA', inicio: '2026-11-02' });
  ctx.db.prepare("INSERT INTO simulacao_comandos (bombona_id, tipo, criado_em) VALUES (1, 'VENDA', ?)").run(new Date().toISOString());
  avancarOperacao(ctx, Date.now() + 3_600_000);
  const p = ctx.db.prepare("SELECT p.id, p.roteiro_id AS r FROM paradas p WHERE p.status = 'PENDENTE' AND p.roteiro_id IS NOT NULL").get() as { id: number; r: number };
  registrarTroca(ctx, p.r, p.id, { encontradas: [] });
}

describe('reset', () => {
  it('reset deixa o banco igual a um recém-criado, inclusive o histórico do seed', () => {
    const novo = criarContexto();
    estadoOperacao(novo);
    const ctx = criarContexto();
    sujar(ctx);
    assert.notEqual(contar(ctx, 'contratos'), contar(novo, 'contratos'));
    resetarSimulacao(ctx);
    for (const t of TABELAS) assert.equal(contar(ctx, t), contar(novo, t), t);
    const e = estadoOperacao(ctx);
    assert.deepEqual([e.pausado, e.velocidade, e.modo, e.fase, e.data, e.dia], [true, 1, 'REAL', 'MANHA', '2026-11-09', 1]);
  });

  it('cada reset sobe a rodada', () => {
    const ctx = criarContexto();
    assert.equal(estadoOperacao(ctx).rodada, 1);
    assert.equal(resetarSimulacao(ctx).rodada, 2);
    assert.equal(resetarSimulacao(ctx).rodada, 3);
    assert.equal(estadoOperacao(ctx).rodada, 3);
  });

  it('com SIMULACAO=off o reset responde 404', async () => {
    const ctx = criarContexto({ simulacaoAtiva: false });
    const api = await subirApi(ctx);
    try {
      const r = await fetch(`${api.url}/operacao/reset`, { method: 'POST' });
      assert.equal(r.status, 404);
      assert.equal(estadoOperacao(ctx).rodada, 1);
    } finally {
      await api.fechar();
    }
  });

  it('reset emite "reset" com o estado novo antes de "operacao"', () => {
    const ctx = criarContexto();
    estadoOperacao(ctx);
    const vistos: Evento[] = [];
    ctx.eventos.ouvir((e) => vistos.push(e));
    resetarSimulacao(ctx);
    assert.equal(vistos[0].tipo, 'reset');
    assert.equal((vistos[0].dados as { rodada: number }).rodada, 2);
    assert.equal(vistos[1].tipo, 'operacao');
    assert.equal((vistos[1].dados as { rodada: number }).rodada, 2);
    assert.ok(vistos.slice(2).every((e) => e.tipo === 'roteiro'));
  });

  it('pedido do simulador com rodada antiga é recusado e não emite nada', async () => {
    const ctx = criarContexto();
    estadoOperacao(ctx);
    const api = await subirApi(ctx);
    try {
      resetarSimulacao(ctx);
      const vistos: Evento[] = [];
      ctx.eventos.ouvir((e) => vistos.push(e));
      const simulador = { Authorization: `Bearer ${ctx.config.tokenSimulador}`, 'Content-Type': 'application/json', 'X-Rodada': '1' };
      const enviar = async (caminho: string, corpo: unknown, headers: Record<string, string>) => {
        const r = await fetch(`${api.url}${caminho}`, { method: 'POST', headers, body: JSON.stringify(corpo) });
        return { status: r.status, corpo: (await r.json()) as { erro: string } };
      };
      const msg = 'Rodada encerrada: a simulação foi reiniciada';
      for (const [caminho, corpo] of [
        ['/roteiros/1/posicao', { lat: 1, lng: 1 }],
        ['/roteiros/1/trajeto', { pontos: [[1, 1], [2, 2]], distanciaM: 5 }],
        ['/roteiros/1/paradas/1/troca', { encontradas: [] }],
        ['/roteiros/1/concluir', {}],
      ] as const) {
        const r = await enviar(caminho, corpo, simulador);
        assert.equal(r.status, 409, caminho);
        assert.equal(r.corpo.erro, msg);
      }
      const { token } = ctx.db.prepare('SELECT token FROM dispositivos LIMIT 1').get() as { token: string };
      const t = await enviar('/telemetria', { lat: -24.9, lng: -53.4, bateria: 80 }, { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Rodada': '1' });
      assert.equal(t.status, 409);
      assert.deepEqual(vistos, []);
      // Com a rodada atual passa.
      const ok = await enviar('/telemetria', { lat: -24.9, lng: -53.4, bateria: 80 }, { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Rodada': '2' });
      assert.equal(ok.status, 202);
    } finally {
      await api.fechar();
    }
  });

  it('sem X-Rodada a telemetria continua aceita', async () => {
    const ctx = criarContexto();
    estadoOperacao(ctx);
    const api = await subirApi(ctx);
    try {
      resetarSimulacao(ctx);
      const { token } = ctx.db.prepare('SELECT token FROM dispositivos LIMIT 1').get() as { token: string };
      const r = await fetch(`${api.url}/telemetria`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: -24.9, lng: -53.4, bateria: 80 }),
      });
      assert.equal(r.status, 202);
    } finally {
      await api.fechar();
    }
  });

  it('POST /operacao/reset devolve o estado novo', async () => {
    const ctx = criarContexto();
    const api = await subirApi(ctx);
    try {
      const r = await fetch(`${api.url}/operacao/reset`, { method: 'POST' });
      assert.equal(r.status, 200);
      const e = (await r.json()) as { rodada: number; pausado: boolean };
      assert.deepEqual([e.rodada, e.pausado], [2, true]);
    } finally {
      await api.fechar();
    }
  });
});
