import type { Severidade, Status, TipoAlerta } from '../api.ts';
import { rotuloAlerta, rotuloRisco, rotuloSeveridade, rotuloStatus } from '../formato.ts';

export const SeloStatus = ({ status }: { status: Status }) => <span className={`selo selo--${status}`}>{rotuloStatus[status]}</span>;

export const SeloAlerta = ({ tipo }: { tipo: TipoAlerta }) => <span className={`selo selo--alerta-${tipo}`}>{rotuloAlerta[tipo]}</span>;

export const SeloSeveridade = ({ severidade }: { severidade: Severidade }) => (
  <span className={`selo selo--sev-${severidade}`}>{rotuloSeveridade[severidade]}</span>
);

export const SeloRisco = ({ risco }: { risco: keyof typeof rotuloRisco }) => (
  <span className={`selo selo--risco-${risco}`}>Risco {rotuloRisco[risco].toLowerCase()}</span>
);

export function Bateria({ nivel }: { nivel: number | null }) {
  if (nivel === null) return <span className="bateria">—</span>;
  const classe = nivel < 20 ? 'bateria--baixa' : nivel < 40 ? 'bateria--media' : '';
  return (
    <span className={`bateria ${classe}`} title={`Bateria do rastreador: ${Math.round(nivel)}%`}>
      <span className="bateria__corpo">
        <span className="bateria__carga" style={{ width: `${Math.max(4, Math.min(100, nivel))}%` }} />
      </span>
      {Math.round(nivel)}%
    </span>
  );
}
