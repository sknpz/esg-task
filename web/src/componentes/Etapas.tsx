import type { Bombona } from '../api.ts';

/** O ciclo da bombona, como a barra de etapas do pedido no app de delivery. Volta ao começo a cada ciclo. */
const ETAPAS = ['No pátio', 'Indo ao cliente', 'No cliente', 'Voltando ao pátio'];

function etapaAtual(b: Bombona) {
  if (b.status === 'PATIO') return 0;
  // Na coleta o cliente é desvinculado: em rota sem cliente é a volta ao pátio.
  if (b.status === 'EM_ROTA') return b.cliente ? 1 : 3;
  if (b.status === 'EM_CLIENTE') return 2;
  // Extraviada: marca a etapa de onde ela sumiu.
  return b.cliente ? 2 : 0;
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function Etapas({ bombona, desde }: { bombona: Bombona; desde?: string }) {
  const atual = etapaAtual(bombona);
  const extraviada = bombona.status === 'EXTRAVIADA';
  return (
    <ol className="etapas" aria-label="Etapas do ciclo da bombona">
      {ETAPAS.map((rotulo, i) => {
        const estado = i < atual ? 'feita' : i === atual ? (extraviada ? 'critica' : 'atual') : 'futura';
        return (
          <li key={rotulo} className={`etapa etapa--${estado}`} aria-current={i === atual ? 'step' : undefined}>
            <span className="etapa__barra" />
            <span className="etapa__rotulo">{rotulo}</span>
            {i === atual && (
              <span className="etapa__quando">{extraviada ? 'extraviada' : desde ? `desde ${hora(desde)}` : ' '}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
