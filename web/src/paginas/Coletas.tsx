import { useCallback, useEffect, useMemo, useState } from 'react';
import { posicaoDoAcompanhado } from '../acompanhamento.ts';
import { api, type Parada, type ResultadoParada, type Roteiro } from '../api.ts';
import { corDoFurgao } from '../componentes/icones.ts';
import { MapaRoteiros } from '../componentes/MapaRoteiros.tsx';
import { distancia, formatarDataOperacao, numero } from '../formato.ts';
import { useMonitoramento } from '../monitoramento.tsx';

const cidadesDe = (r: Roteiro) => {
  const cidades = [...new Set(r.paradas.map((p) => p.cliente.cidade))];
  return cidades.length > 3 ? `${cidades.slice(0, 3).join(', ')} e mais ${cidades.length - 3}` : cidades.join(' → ');
};

function situacao(r: Roteiro) {
  if (r.status === 'PLANEJADO') return 'Aguardando';
  if (r.status === 'CONCLUIDO') return 'No pátio';
  const feitas = r.paradas.filter((p) => p.status !== 'PENDENTE').length;
  return `Em rota · parada ${Math.min(feitas + 1, r.paradas.length)} de ${r.paradas.length}`;
}

/** Texto do que aconteceu numa parada. */
function textoResultado(p: Parada) {
  const r: ResultadoParada | null = p.resultado;
  if (!r) return null;
  const partes: string[] = [];
  const trocas = Math.min(r.levadas.length, r.deixadas.length);
  for (let i = 0; i < trocas; i++) partes.push(`trocou ${r.levadas[i].codigo} ↔ ${r.deixadas[i]}`);
  const levadasSobra = r.levadas.slice(trocas);
  const deixadasSobra = r.deixadas.slice(trocas);
  if (deixadasSobra.length) partes.push(`deixou ${deixadasSobra.length}`);
  if (levadasSobra.length) {
    const codigos = levadasSobra.map((b) => b.codigo).join(', ');
    partes.push(p.motivo === 'RETIRADA' ? `retirada: ${codigos}` : `retirou ${codigos}`);
  }
  for (const n of r.naoEncontradas) partes.push(`não encontrada: ${n.codigo}${n.incidente ? ' (conta no risco)' : ''}`);
  if (r.observacao) partes.push(r.observacao);
  return partes.join(' · ') || null;
}

export function Coletas() {
  const { roteiros, operacao, bombonas, carregado } = useMonitoramento();
  const [naoAtendidas, setNaoAtendidas] = useState<Parada[]>([]);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [acompanhado, setAcompanhado] = useState<number | null>(null);
  const [reenquadrar, setReenquadrar] = useState(0);
  const rodada = operacao?.rodada;
  // Os ids dos roteiros recomeçam no reset: a seleção antiga apontaria para outro furgão.
  useEffect(() => {
    setSelecionado(null);
    setAcompanhado(null);
  }, [rodada]);
  // O furgão acompanhado concluiu ou sumiu (outro dia): desliga, e o mapa fica onde está. Na rua ainda sem a primeira
  // posição, espera por ela.
  const alvo = posicaoDoAcompanhado(roteiros, acompanhado);
  const naRua = acompanhado !== null && roteiros.some((r) => r.id === acompanhado && r.status === 'EM_ANDAMENTO');
  useEffect(() => {
    if (acompanhado !== null && !naRua) setAcompanhado(null);
  }, [acompanhado, naRua]);
  const soltar = useCallback(() => setAcompanhado(null), []);
  const acompanhar = (id: number) => {
    setSelecionado(id);
    setAcompanhado(id);
  };
  const pararDeAcompanhar = () => {
    setAcompanhado(null);
    setReenquadrar((n) => n + 1);
  };
  const escolher = (id: number) => {
    const novo = selecionado === id ? null : id;
    setSelecionado(novo);
    if (acompanhado !== null && acompanhado !== novo) setAcompanhado(null);
  };
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // `naoAtendidas` não vem no monitoramento: busca de novo a cada mudança de roteiros ou de dia.
  const assinatura = `${operacao?.data}|${roteiros.map((r) => `${r.id}:${r.status}:${r.paradas.filter((p) => p.status !== 'PENDENTE').length}`).join(',')}`;
  useEffect(() => {
    let ativo = true;
    api
      .roteiros(operacao?.data)
      .then((d) => ativo && setNaoAtendidas(d.naoAtendidas))
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [assinatura]);

  const escolhido = roteiros.find((r) => r.id === selecionado) ?? null;
  const totalColetas = useMemo(() => roteiros.reduce((n, r) => n + r.paradas.length, 0), [roteiros]);

  const venderSilenciosa = async () => {
    setEnviando(true);
    setMensagem(null);
    try {
      const res = (await api.simular(null, 'VENDA_SILENCIOSA')) as { bombona?: string };
      const b = res.bombona ? bombonas[res.bombona] : undefined;
      const cliente = b?.cliente ? `${b.cliente.nome} (${b.cliente.cidade})` : 'um cliente';
      setMensagem(
        `A bombona ${res.bombona ?? ''} de ${cliente} foi levada sem o rastreador acusar nada. O sumiço só aparece na próxima coleta desse cliente.`,
      );
    } catch (e) {
      setMensagem((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="coletas">
      <aside className="coletas__lateral">
        <div className="coletas__topo">
          <div className="coletas__titulo">
            {operacao ? formatarDataOperacao(operacao.data) : 'Hoje'} · {numero(totalColetas)} {totalColetas === 1 ? 'coleta' : 'coletas'} ·{' '}
            {roteiros.length} {roteiros.length === 1 ? 'furgão' : 'furgões'}
          </div>
          <button
            className="botao botao--simulacao"
            onClick={venderSilenciosa}
            disabled={enviando}
            title="Simula uma venda em que o rastreador foi arrancado antes de sair do cliente"
          >
            Venda com rastreador arrancado
          </button>
          {mensagem && <p className="suave simulacao__msg">{mensagem}</p>}
          <p className="suave coletas__nota">Na vida real as vendas clandestinas são frequentes; na demonstração elas ficam raras de propósito.</p>
        </div>

        {carregado && roteiros.length === 0 && <p className="suave coletas__vazio">Sem coletas neste dia.</p>}

        <ul className="coletas__furgoes">
          {roteiros.map((r) => (
            <li key={r.id}>
              <button
                className={`furgao ${selecionado === r.id ? 'furgao--selecionado' : ''}`}
                style={{ borderLeftColor: corDoFurgao(r.numero) }}
                onClick={() => escolher(r.id)}
              >
                <strong>Furgão {r.numero}</strong>
                <span className="furgao__cidades"> · {cidadesDe(r)}</span>
                <span className="furgao__linha">
                  {r.paradas.length} paradas · {r.carga}/{r.capacidade} bombonas · {distancia(r.distanciaM)}
                </span>
                <span className="furgao__situacao">{situacao(r)}</span>
              </button>
              {r.status === 'EM_ANDAMENTO' && (
                <button
                  type="button"
                  className={`botao botao--pequeno furgao__acompanhar ${acompanhado === r.id ? 'botao--primario' : ''}`}
                  aria-pressed={acompanhado === r.id}
                  onClick={() => (acompanhado === r.id ? pararDeAcompanhar() : acompanhar(r.id))}
                >
                  {acompanhado === r.id ? 'Parar de acompanhar' : 'Acompanhar'}
                </button>
              )}
            </li>
          ))}
        </ul>

        {escolhido && (
          <section className="coletas__paradas">
            <div className="coletas__rotulo">Furgão {escolhido.numero} · paradas</div>
            <ol>
              {escolhido.paradas.map((p) => {
                const texto = textoResultado(p);
                return (
                  <li key={p.id} className={`parada parada--${p.status.toLowerCase()}`}>
                    <span className="parada__marca">{p.status === 'FEITA' ? '✔' : p.status === 'NAO_ATENDIDA' ? '✖' : p.ordem}</span>
                    <span>
                      <strong>{p.cliente.nome}</strong> · {p.cliente.cidade} ·{' '}
                      {p.motivo === 'RETIRADA' ? 'retirada' : `${p.demanda} ${p.demanda === 1 ? 'bombona' : 'bombonas'}`}
                      {texto && <span className="parada__resultado">{texto}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {naoAtendidas.length > 0 && (
          <section className="coletas__paradas">
            <div className="coletas__rotulo">Não atendidas ({naoAtendidas.length})</div>
            <ul>
              {naoAtendidas.map((p) => (
                <li key={p.id} className="parada parada--nao_atendida">
                  <span className="parada__marca">✖</span>
                  <span>
                    <strong>{p.cliente.nome}</strong> · {p.cliente.cidade}
                    <span className="parada__resultado">{p.resultado?.observacao ?? 'Não atendida'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>

      <div className="coletas__mapa">
        <MapaRoteiros
          key={rodada}
          roteiros={roteiros}
          selecionado={selecionado}
          acompanhado={alvo}
          aoSoltar={soltar}
          reenquadrar={reenquadrar}
        />
      </div>
    </div>
  );
}
