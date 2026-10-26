import { Link } from 'react-router-dom';
import { SeloRisco } from '../componentes/Selos.tsx';
import { tempoRelativo } from '../formato.ts';
import { useMonitoramento } from '../monitoramento.tsx';

export function Clientes() {
  const { clientes, agora } = useMonitoramento();
  const porRisco = { ALTO: 0, MEDIO: 0, BAIXO: 0 };
  for (const c of clientes) porRisco[c.risco]++;

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

      <div className="tabela-rolagem">
        <table className="tabela">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Cidade</th>
              <th className="num">Bombonas</th>
              <th className="num">Cerca</th>
              <th className="num">Incidentes</th>
              <th>Último incidente</th>
              <th>Risco</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
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
