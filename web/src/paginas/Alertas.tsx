import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Alerta } from '../api.ts';
import { SeloAlerta, SeloSeveridade } from '../componentes/Selos.tsx';
import { dataHora, tempoRelativo } from '../formato.ts';
import { useMonitoramento } from '../monitoramento.tsx';

type Aba = 'ABERTO' | 'RESOLVIDO';

export function Alertas() {
  const { alertasAbertos, agora } = useMonitoramento();
  const [aba, setAba] = useState<Aba>('ABERTO');
  const [resolvidos, setResolvidos] = useState<Alerta[] | null>(null);

  // O histórico muda quando algum alerta aberto é resolvido (mesmo que outro abra ao mesmo tempo).
  const idsAbertos = alertasAbertos.map((a) => a.id).join();
  useEffect(() => {
    if (aba === 'RESOLVIDO') api.alertas('RESOLVIDO').then(setResolvidos).catch(() => {});
  }, [aba, idsAbertos]);

  const linhas = aba === 'ABERTO' ? alertasAbertos : (resolvidos ?? []);

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Alertas</h1>
          <p className="suave">Gerados pelas regras de cerca, extravio, sinal e bateria. Os de cerca se fecham sozinhos se a bombona voltar.</p>
        </div>
        <div className="abas" role="tablist">
          <button role="tab" aria-selected={aba === 'ABERTO'} className={`aba ${aba === 'ABERTO' ? 'aba--ativa' : ''}`} onClick={() => setAba('ABERTO')}>
            Abertos <span className="filtro__n">{alertasAbertos.length}</span>
          </button>
          <button role="tab" aria-selected={aba === 'RESOLVIDO'} className={`aba ${aba === 'RESOLVIDO' ? 'aba--ativa' : ''}`} onClick={() => setAba('RESOLVIDO')}>
            Histórico
          </button>
        </div>
      </div>

      {linhas.length === 0 ? (
        <div className="vazio">
          {aba === 'ABERTO' ? 'Nenhum alerta aberto. Todas as bombonas estão onde deveriam.' : resolvidos ? 'Nenhum alerta resolvido ainda.' : 'Carregando…'}
        </div>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>Severidade</th>
                <th>Tipo</th>
                <th>Bombona</th>
                <th>Cliente</th>
                <th>O que aconteceu</th>
                <th>{aba === 'ABERTO' ? 'Aberto' : 'Período'}</th>
                <th>{aba === 'ABERTO' ? '' : 'Resolução'}</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((a) => (
                <LinhaAlerta key={a.id} alerta={a} agora={agora} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LinhaAlerta({ alerta: a, agora }: { alerta: Alerta; agora: number }) {
  const [resolvendo, setResolvendo] = useState(false);
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const resolver = async () => {
    try {
      await api.resolverAlerta(a.id, observacao);
      setResolvendo(false);
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  return (
    <>
      <tr className={a.status === 'ABERTO' ? `linha--${a.severidade}` : ''}>
        <td>
          <SeloSeveridade severidade={a.severidade} />
        </td>
        <td>
          <SeloAlerta tipo={a.tipo} />
        </td>
        <td>
          <Link to={`/?b=${a.bombona}`} className="link-codigo">
            {a.bombona}
          </Link>
        </td>
        <td>{a.cliente ?? <span className="suave">Pátio</span>}</td>
        <td>{a.mensagem}</td>
        <td className="nowrap" title={dataHora(a.abertoEm)}>
          {a.status === 'ABERTO' ? tempoRelativo(a.abertoEm, agora) : `${dataHora(a.abertoEm)} → ${dataHora(a.resolvidoEm)}`}
        </td>
        <td>
          {a.status === 'ABERTO' ? (
            !resolvendo && (
              <button className="botao botao--pequeno" onClick={() => setResolvendo(true)}>
                Resolver
              </button>
            )
          ) : (
            <span className="resolucao">
              <small>{a.resolvidoPor === 'SISTEMA' ? 'Automático' : 'Operador'}</small>
              {a.resolucao}
            </span>
          )}
        </td>
      </tr>
      {resolvendo && (
        <tr className="linha-resolver">
          <td colSpan={7}>
            <form
              className="resolver"
              onSubmit={(e) => {
                e.preventDefault();
                resolver();
              }}
            >
              <input
                className="campo"
                autoFocus
                placeholder="O que foi feito? (ex.: cliente devolveu, estava no depósito dos fundos)"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
              />
              <button className="botao botao--primario" disabled={observacao.trim().length < 3}>
                Confirmar
              </button>
              <button type="button" className="botao" onClick={() => setResolvendo(false)}>
                Cancelar
              </button>
            </form>
            {a.tipo === 'FORA_DA_AREA' || a.tipo === 'EXTRAVIO' ? (
              <p className="suave dica">Se a bombona continuar fora da cerca, o alerta abre de novo na próxima leitura.</p>
            ) : null}
            {erro && <p className="erro">{erro}</p>}
          </td>
        </tr>
      )}
    </>
  );
}
