import { useNavigate } from 'react-router-dom';
import { rotuloAlerta } from '../formato.ts';
import { useMonitoramento } from '../monitoramento.tsx';

/** Notificações de alertas novos que chegam em tempo real. */
export function Avisos() {
  const { avisos, dispensarAviso } = useMonitoramento();
  const navegar = useNavigate();
  return (
    <div className="avisos" aria-live="polite">
      {avisos.map(({ id, alerta }) => (
        <div key={id} className={`aviso aviso--${alerta.severidade}`} role="status">
          <button
            className="aviso__conteudo"
            onClick={() => {
              navegar(`/?b=${alerta.bombona}`);
              dispensarAviso(id);
            }}
          >
            <strong>
              {rotuloAlerta[alerta.tipo]} · {alerta.bombona}
            </strong>
            <span>{alerta.mensagem}</span>
          </button>
          <button className="botao-icone" onClick={() => dispensarAviso(id)} aria-label="Dispensar">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
