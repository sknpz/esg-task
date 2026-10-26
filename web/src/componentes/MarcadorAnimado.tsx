import type L from 'leaflet';
import { useEffect, useRef, type ReactNode } from 'react';
import { Marker } from 'react-leaflet';
import type { Ponto } from '../api.ts';

type Props = {
  posicao: Ponto;
  icone: L.DivIcon;
  zIndexOffset?: number;
  aoClicar?: () => void;
  children?: ReactNode;
};

const DURACAO_MS = 1200;

/** Marcador que desliza até a nova posição, como o entregador no app de delivery. */
export function MarcadorAnimado({ posicao, icone, zIndexOffset, aoClicar, children }: Props) {
  const ref = useRef<L.Marker>(null);
  // O Marker só usa a posição inicial; as seguintes são animadas aqui.
  const inicial = useRef(posicao);

  useEffect(() => {
    const marcador = ref.current;
    if (!marcador) return;
    const de = marcador.getLatLng();
    if (de.lat === posicao.lat && de.lng === posicao.lng) return;
    const t0 = performance.now();
    let quadro = 0;
    const passo = (t: number) => {
      const k = Math.min(1, (t - t0) / DURACAO_MS);
      const e = 1 - (1 - k) ** 3;
      marcador.setLatLng([de.lat + (posicao.lat - de.lat) * e, de.lng + (posicao.lng - de.lng) * e]);
      if (k < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [posicao.lat, posicao.lng]);

  return (
    <Marker
      ref={ref}
      position={[inicial.current.lat, inicial.current.lng]}
      icon={icone}
      zIndexOffset={zIndexOffset}
      eventHandlers={aoClicar ? { click: aoClicar } : undefined}
    >
      {children}
    </Marker>
  );
}
