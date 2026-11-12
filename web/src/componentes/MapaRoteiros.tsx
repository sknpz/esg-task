import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { Circle, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet';
import { precisaZoom } from '../acompanhamento.ts';
import type { Ponto, Roteiro } from '../api.ts';
import { useMonitoramento } from '../monitoramento.tsx';
import { corDoFurgao, iconeFurgao, iconeParada, iconePatio } from './icones.ts';
import { MarcadorAnimado } from './MarcadorAnimado.tsx';

const URL_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const CIANORTE: [number, number] = [-23.66, -52.64];
/** Zoom de rua ao acompanhar um furgão. */
const ZOOM_ACOMPANHAR = 15;

type Props = {
  roteiros: Roteiro[];
  selecionado: number | null;
  /** Posição do furgão acompanhado (o mapa vai atrás dele); null sem acompanhamento ou ainda sem posição. */
  acompanhado?: Ponto | null;
  /** Id do roteiro acompanhado: trocar de furgão dá o zoom de rua de novo. */
  acompanhadoId?: number | null;
  /** O operador arrastou o mapa: o acompanhamento desliga. */
  aoSoltar?: () => void;
  /** Muda para pedir um novo enquadramento (ao parar de acompanhar pelo botão). */
  reenquadrar?: number;
};

/** Mapa do dia: rota de cada furgão pelas ruas, pinos numerados na ordem das paradas e o furgão ao vivo. */
export function MapaRoteiros({ roteiros, selecionado, acompanhado = null, acompanhadoId = null, aoSoltar, reenquadrar = 0 }: Props) {
  const { config } = useMonitoramento();

  return (
    <MapContainer center={CIANORTE} zoom={10} zoomControl={false} className="mapa">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url={URL_TILES}
        updateWhenZooming={false}
      />
      <ZoomControl position="topleft" />
      {config && (
        <>
          <Circle center={config.patio} radius={config.patio.raioM} pathOptions={{ className: 'cerca cerca--patio' }} />
          <Marker position={config.patio} icon={iconePatio} zIndexOffset={-500}>
            <Tooltip direction="top" offset={[0, -16]}>
              <strong>{config.patio.nome}</strong>
            </Tooltip>
          </Marker>
        </>
      )}
      {roteiros.map((r) => {
        const cor = corDoFurgao(r.numero);
        const apagado = selecionado !== null && selecionado !== r.id;
        return (
          <RoteiroNoMapa key={r.id} roteiro={r} cor={cor} apagado={apagado} />
        );
      })}
      <Enquadrar roteiros={roteiros} selecionado={selecionado} acompanhando={acompanhado !== null} reenquadrar={reenquadrar} />
      <Seguir alvo={acompanhado} id={acompanhadoId} aoSoltar={aoSoltar} />
    </MapContainer>
  );
}

function RoteiroNoMapa({ roteiro: r, cor, apagado }: { roteiro: Roteiro; cor: string; apagado: boolean }) {
  return (
    <>
      {r.trajeto && r.trajeto.length > 1 && (
        <Polyline positions={r.trajeto} pathOptions={{ color: cor, weight: apagado ? 3 : 5, opacity: apagado ? 0.25 : 0.85 }} />
      )}
      {r.paradas
        .filter((p) => p.ordem !== null)
        .map((p) => (
          <Marker
            key={p.id}
            position={[p.cliente.lat, p.cliente.lng]}
            icon={iconeParada(p.ordem!, cor, p.status === 'FEITA')}
            opacity={apagado ? 0.4 : 1}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              <strong>
                {p.ordem}. {p.cliente.nome}
              </strong>
              <br />
              {p.cliente.cidade} · {p.motivo === 'RETIRADA' ? 'retirada' : 'coleta'}
            </Tooltip>
          </Marker>
        ))}
      {r.posicao && (
        <MarcadorAnimado posicao={r.posicao} icone={iconeFurgao(r.numero)} zIndexOffset={800}>
          <Tooltip direction="top" offset={[0, -16]}>
            Furgão {r.numero}
          </Tooltip>
        </MarcadorAnimado>
      )}
    </>
  );
}

/**
 * Vai atrás do furgão acompanhado: zoom de rua ao ligar ou trocar de furgão e, a cada posição nova, recentraliza.
 * Arrastar o mapa desliga (zoom pela roda ou pelos botões não).
 */
function Seguir({ alvo, id, aoSoltar }: { alvo: Ponto | null; id: number | null; aoSoltar?: () => void }) {
  const map = useMap();
  /** Furgão que o mapa já está seguindo (já recebeu o zoom de rua). */
  const seguido = useRef<number | null>(null);
  const ligado = id !== null;

  useEffect(() => {
    if (id === null) {
      seguido.current = null;
      return;
    }
    if (!alvo) return; // na rua, mas ainda sem posição: espera
    if (precisaZoom(seguido.current, id)) {
      seguido.current = id;
      map.setView(alvo, ZOOM_ACOMPANHAR);
    } else {
      map.panTo(alvo, { animate: true, duration: 0.25 });
    }
  }, [id, alvo?.lat, alvo?.lng, map]);

  useEffect(() => {
    if (!ligado || !aoSoltar) return;
    map.on('dragstart', aoSoltar);
    return () => void map.off('dragstart', aoSoltar);
  }, [ligado, aoSoltar, map]);

  return null;
}

/**
 * Enquadra todos os roteiros na primeira carga e o furgão escolhido quando muda a seleção. Enquanto acompanha um
 * furgão, quem manda no mapa é o `Seguir`; parar pelo botão (`reenquadrar` muda) volta a enquadrar.
 */
function Enquadrar({
  roteiros,
  selecionado,
  acompanhando,
  reenquadrar,
}: {
  roteiros: Roteiro[];
  selecionado: number | null;
  acompanhando: boolean;
  reenquadrar: number;
}) {
  const map = useMap();
  const { config } = useMonitoramento();
  const ultimo = useRef<string | null>(null);

  const pontos = useMemo(() => {
    const alvo = selecionado === null ? roteiros : roteiros.filter((r) => r.id === selecionado);
    const lista: [number, number][] = [];
    for (const r of alvo) {
      for (const p of r.paradas) lista.push([p.cliente.lat, p.cliente.lng]);
      if (r.trajeto) lista.push(...r.trajeto);
    }
    if (config) lista.push([config.patio.lat, config.patio.lng]);
    return lista;
  }, [roteiros, selecionado, config]);

  // Só reenquadra ao trocar a seleção ou quando chegam os primeiros dados; o resto do tempo a tela é do operador.
  const chave = `${selecionado}|${roteiros.map((r) => r.id).join(',')}|${pontos.length > 0}|${reenquadrar}`;
  useEffect(() => {
    if (pontos.length === 0 || ultimo.current === chave) return;
    ultimo.current = chave;
    // Acompanhando: a mudança fica registrada, mas não reenquadra (nem depois, quando o arrasto soltar o furgão).
    if (acompanhando) return;
    map.fitBounds(L.latLngBounds(pontos), { padding: [40, 40] });
  }, [chave, pontos, map, acompanhando]);

  return null;
}
