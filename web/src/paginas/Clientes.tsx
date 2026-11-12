import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Cliente, Frequencia } from '../api.ts';
import { SeloRisco } from '../componentes/Selos.tsx';
import { filtrarClientes, proximaOrdem, type FiltroClientes } from '../filtroClientes.ts';
import { tempoRelativo } from '../formato.ts';
import { useMonitoramento } from '../monitoramento.tsx';

const RISCOS: { valor: Cliente['risco']; rotulo: string }[] = [
  { valor: 'ALTO', rotulo: 'Alto' },
  { valor: 'MEDIO', rotulo: 'Médio' },
  { valor: 'BAIXO', rotulo: 'Baixo' },
];
const MODALIDADES: { valor: Frequencia | 'SEM'; rotulo: string }[] = [
  { valor: 'DIARIA', rotulo: 'Diária' },
  { valor: 'SEMANAL', rotulo: 'Semanal' },
  { valor: 'QUINZENAL', rotulo: 'Quinzenal' },
  { valor: 'MENSAL', rotulo: 'Mensal' },
  { valor: 'SEM', rotulo: 'Sem contrato' },
];

/** Liga ou desliga um valor numa lista de filtro. */
const alternar = <T,>(lista: T[], valor: T) => (lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor]);

export function Clientes() {
  const { clientes, agora } = useMonitoramento();
  const porRisco = { ALTO: 0, MEDIO: 0, BAIXO: 0 };
  for (const c of clientes) porRisco[c.risco]++;
  const [filtro, setFiltro] = useState<FiltroClientes>({ busca: '', riscos: [], modalidades: [], ordem: null });
  const visiveis = useMemo(() => filtrarClientes(clientes, filtro), [clientes, filtro]);
  const mudar = (parte: Partial<FiltroClientes>) => setFiltro((f) => ({ ...f, ...parte }));
  const seta = filtro.ordem === 'DESC' ? ' ▼' : filtro.ordem === 'ASC' ? ' ▲' : '';
  const proximaDescricao = { DESC: 'crescente', ASC: 'ordem original', nulo: 'decrescente' }[filtro.ordem ?? 'nulo'];

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Clientes</h1>
          <p className="suave">
            O risco vem do histórico de saídas da cerca: nenhuma é baixo, 1 a 2 é médio, 3 ou mais é alto. Serve para decidir se o
            cliente continua recebendo bombonas ou passa a pagar caução.
          </p>
        </div>
        <div className="resumo-risco">
          <SeloRisco risco="ALTO" /> {porRisco.ALTO}
          <SeloRisco risco="MEDIO" /> {porRisco.MEDIO}
          <SeloRisco risco="BAIXO" /> {porRisco.BAIXO}
        </div>
      </div>

      <div className="clientes__filtros">
        <input
          className="campo clientes__busca"
          type="search"
          placeholder="Pesquisar por nome, cidade ou endereço"
          aria-label="Pesquisar clientes"
          value={filtro.busca}
          onChange={(e) => mudar({ busca: e.target.value })}
        />
        <div className="filtros" role="group" aria-label="Filtrar por risco">
          <span className="clientes__rotulo">Risco</span>
          {RISCOS.map((r) => (
            <button
              key={r.valor}
              type="button"
              className={`filtro ${filtro.riscos.includes(r.valor) ? 'filtro--ativo' : ''}`}
              aria-pressed={filtro.riscos.includes(r.valor)}
              onClick={() => mudar({ riscos: alternar(filtro.riscos, r.valor) })}
            >
              {r.rotulo}
            </button>
          ))}
        </div>
        <div className="filtros" role="group" aria-label="Filtrar por modalidade do contrato">
          <span className="clientes__rotulo">Contrato</span>
          {MODALIDADES.map((m) => (
            <button
              key={m.valor}
              type="button"
              className={`filtro ${filtro.modalidades.includes(m.valor) ? 'filtro--ativo' : ''}`}
              aria-pressed={filtro.modalidades.includes(m.valor)}
              onClick={() => mudar({ modalidades: alternar(filtro.modalidades, m.valor) })}
            >
              {m.rotulo}
            </button>
          ))}
        </div>
        <p className="suave pequeno clientes__contador">
          {visiveis.length} de {clientes.length} {clientes.length === 1 ? 'cliente' : 'clientes'}
        </p>
      </div>

      <div className="tabela-rolagem">
        <table className="tabela">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Cidade</th>
              <th className="num" aria-sort={filtro.ordem === 'DESC' ? 'descending' : filtro.ordem === 'ASC' ? 'ascending' : 'none'}>
                <button
                  type="button"
                  className="cabecalho-ordenar"
                  title={`Ordenar por bombonas (${proximaDescricao})`}
                  onClick={() => mudar({ ordem: proximaOrdem(filtro.ordem) })}
                >
                  Bombonas{seta}
                </button>
              </th>
              <th className="num">Cerca</th>
              <th className="num">Incidentes</th>
              <th>Último incidente</th>
              <th>Risco</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && (
              <tr>
                <td colSpan={8} className="suave">
                  Nenhum cliente com esses filtros.
                </td>
              </tr>
            )}
            {visiveis.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.nome}</strong>
                  <div className="suave pequeno">
                    {c.tipo} · {c.endereco}
                  </div>
                </td>
                <td>{c.cidade}</td>
                <td className="num">{c.bombonas}</td>
                <td className="num">{c.raioM} m</td>
                <td className="num">{c.incidentes}</td>
                <td>{c.ultimoIncidente ? tempoRelativo(c.ultimoIncidente, agora) : <span className="suave">—</span>}</td>
                <td>
                  <SeloRisco risco={c.risco} />
                </td>
                <td>
                  <Link to={`/?c=${c.id}`} className="botao botao--pequeno">
                    Ver no mapa
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
