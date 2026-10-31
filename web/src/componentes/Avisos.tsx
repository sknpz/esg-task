import { useNavigate } from 'react-router-dom';
import { useMonitoramento } from '../monitoramento.tsx';

/** Notificações em tempo real: alertas novos e etapas concluídas. */
export function Avisos() {
  const { avisos, dispensarAviso } = useMonitoramento();
  const navegar = useNavigate();
  return (
    <div className="avisos" aria-live="polite">
      {avisos.map((aviso) => (
        <div key={aviso.id} className={`aviso aviso--${aviso.tom}`} role="status">
          <button
            className="aviso__conteudo"
            onClick={() => {
              navegar(`/?b=${aviso.bombona}`);
              dispensarAviso(aviso.id);
            }}
          >
            <strong>{aviso.titulo}</strong>
            <span>{aviso.texto}</span>
          </button>
          <button className="botao-icone" onClick={() => dispensarAviso(aviso.id)} aria-label="Dispensar">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
