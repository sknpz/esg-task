import { useEffect, useMemo, useState } from 'react';
import { api, type Bombona, type DetalheBombona } from '../api.ts';
import { Bateria, SeloAlerta, SeloStatus } from '../componentes/Selos.tsx';
import { dataHora, distancia, rotuloAlerta, rotuloMovimentacao, tempoRelativo } from '../formato.ts';
import { useMonitoramento } from '../monitoramento.tsx';

type Props = { codigo: string; aoFechar: () => void };

/** O cartão de "onde está meu pedido", só que da bombona. */
function situacao(b: Bombona) {
  const onde = b.cliente?.nome ?? 'pátio';
  if (b.status === 'EXTRAVIADA') {
    return { tom: 'critico', titulo: `Extraviada a ${distancia(b.distanciaM)} de ${onde}`, texto: 'Possível venda ou descarte. Acompanhando em tempo real.' };
  }
  if (b.alertasAbertos.includes('FORA_DA_AREA')) {
    return { tom: 'aviso', titulo: `Saiu da cerca de ${onde}`, texto: `Está a ${distancia(b.distanciaM)} do ponto esperado e sendo acompanhada.` };
  }
  if (b.status === 'EM_ROTA') {
    return { tom: 'rota', titulo: `A caminho de ${b.destino?.nome}`, texto: `Faltam ${distancia(b.distanciaM)} até o destino.` };
  }
  if (b.status === 'PATIO') {
    return { tom: 'ok', titulo: 'No pátio da Bio Óleo', texto: 'Disponível para a próxima entrega.' };
  }
  return { tom: 'ok', titulo: `Parada em ${onde}`, texto: `A ${distancia(b.distanciaM)} do ponto, dentro da cerca de ${b.localEsperado?.raioM} m.` };
}

type Evento = { quando: string; titulo: string; texto?: string | null; tom: string };

export function PainelBombona({ codigo, aoFechar }: Props) {
  const { bombonas, agora } = useMonitoramento();
  const b = bombonas[codigo];
  const [detalhe, setDetalhe] = useState<DetalheBombona | null>(null);

  // Recarrega o histórico só quando algo relevante muda, não a cada leitura.
  const versao = `${b.status}|${b.alertasAbertos.join()}|${b.cliente?.id}`;
  useEffect(() => {
    let ativo = true;
    api.bombona(codigo).then((d) => ativo && setDetalhe(d));
    return () => {
      ativo = false;
    };
  }, [codigo, versao]);

  const linhaDoTempo = useMemo<Evento[]>(() => {
    if (!detalhe) return [];
    const eventos: Evento[] = detalhe.movimentacoes.map((m) => ({
      quando: m.criadoEm,
      titulo: `${rotuloMovimentacao[m.tipo] ?? m.tipo}${m.cliente ? ` · ${m.cliente}` : ''}`,
      texto: m.observacao,
      tom: 'mov',
    }));
    for (const a of detalhe.alertas) {
      eventos.push({ quando: a.abertoEm, titulo: `Alerta: ${rotuloAlerta[a.tipo]}`, texto: a.mensagem, tom: a.severidade === 'CRITICO' ? 'critico' : 'aviso' });
      if (a.resolvidoEm) {
        eventos.push({
          quando: a.resolvidoEm,
          titulo: `${rotuloAlerta[a.tipo]} resolvido${a.resolvidoPor === 'SISTEMA' ? ' automaticamente' : ''}`,
          texto: a.resolucao,
          tom: 'ok',
        });
      }
    }
    return eventos.sort((x, y) => y.quando.localeCompare(x.quando)).slice(0, 20);
  }, [detalhe]);

  const s = situacao(b);
  const alertasAbertos = detalhe?.alertas.filter((a) => a.status === 'ABERTO') ?? [];

  return (
    <section className="painel" aria-label={`Bombona ${codigo}`}>
      <header className="painel__topo">
        <div>
          <h2 className="painel__titulo">{b.codigo}</h2>
          <SeloStatus status={b.status} />
        </div>
        <button className="botao-icone" onClick={aoFechar} aria-label="Fechar">
          ×
        </button>
      </header>

      <div className="painel__corpo">
        <div className={`situacao situacao--${s.tom}`}>
          <span className="situacao__pulso" />
          <div>
            <strong>{s.titulo}</strong>
            <p>{s.texto}</p>
          </div>
        </div>

        <dl className="fatos">
          <div>
            <dt>Bateria</dt>
            <dd>
              <Bateria nivel={b.bateria} />
            </dd>
          </div>
          <div>
            <dt>Último sinal</dt>
            <dd className={b.alertasAbertos.includes('SEM_SINAL') ? 'texto-alerta' : ''}>{tempoRelativo(b.ultimoSinal, agora)}</dd>
          </div>
          <div>
            <dt>Rastreador</dt>
            <dd>{b.dispositivoId}</dd>
          </div>
          <div>
            <dt>Capacidade</dt>
            <dd>{b.capacidadeL} L</dd>
          </div>
          {b.cliente && (
            <div className="fatos__largo">
              <dt>{b.status === 'EM_ROTA' ? 'Destino' : 'Cliente'}</dt>
              <dd>
                {b.cliente.nome} · {b.cliente.cidade}
              </dd>
            </div>
          )}
        </dl>

        {alertasAbertos.length > 0 && (
          <div className="bloco">
            <h3>Alertas abertos</h3>
            <ul className="alertas-mini">
              {alertasAbertos.map((a) => (
                <li key={a.id}>
                  <SeloAlerta tipo={a.tipo} />
                  <span>{a.mensagem}</span>
                  <time>{tempoRelativo(a.abertoEm, agora)}</time>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bloco">
          <h3>Linha do tempo</h3>
          {!detalhe && <p className="suave">Carregando…</p>}
          <ol className="linha-tempo">
            {linhaDoTempo.map((e, i) => (
              <li key={i} className={`linha-tempo__item linha-tempo__item--${e.tom}`}>
                <time>{dataHora(e.quando)}</time>
                <strong>{e.titulo}</strong>
                {e.texto && <p>{e.texto}</p>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
