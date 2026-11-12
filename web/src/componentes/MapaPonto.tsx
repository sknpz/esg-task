import L from 'leaflet';
import { useState } from 'react';
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMapEvents } from 'react-leaflet';
import type { Local, Ponto } from '../api.ts';
import { iconePatio } from './icones.ts';

/** Área de atuação: o servidor recusa cliente novo a mais de 250 km do pátio. */
export const RAIO_ATUACAO_KM = 250;
/** Cerca de um cliente novo (o padrão da tabela de clientes). */
const RAIO_CERCA_M = 150;
const URL_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const iconeClienteNovo = L.divIcon({ className: '', html: '<div class="pino-novo"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

/** Mapa pequeno para marcar onde fica um cliente novo: clicar põe (ou move) o pino; fora da área, só avisa. */
export function MapaPonto({ ponto, patio, aoEscolher }: { ponto: Ponto | null; patio: Local; aoEscolher: (p: Ponto) => void }) {
  const [foraDaArea, setForaDaArea] = useState(false);
  return (
    <div className="mapa-ponto">
      <MapContainer center={ponto ?? patio} zoom={11} className="mapa-ponto__mapa">
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url={URL_TILES} />
        <Marker position={patio} icon={iconePatio}>
          <Tooltip direction="top" offset={[0, -16]}>
            {patio.nome}
          </Tooltip>
        </Marker>
        {ponto && (
          <>
            <Circle center={ponto} radius={RAIO_CERCA_M} pathOptions={{ className: 'cerca' }} />
            <Marker position={ponto} icon={iconeClienteNovo} />
          </>
        )}
        <Cliques
          aoClicar={(p) => {
            const fora = L.latLng(patio.lat, patio.lng).distanceTo(L.latLng(p.lat, p.lng)) > RAIO_ATUACAO_KM * 1000;
            setForaDaArea(fora);
            if (!fora) aoEscolher(p);
          }}
        />
      </MapContainer>
      <p className={`pequeno ${foraDaArea ? 'erro-form' : 'suave'}`} role={foraDaArea ? 'alert' : undefined}>
        {foraDaArea
          ? `Fora da área de atuação (${RAIO_ATUACAO_KM} km do pátio).`
          : ponto
            ? 'Clique de novo para mudar o local.'
            : 'Clique no mapa onde o cliente fica.'}
      </p>
    </div>
  );
}

function Cliques({ aoClicar }: { aoClicar: (p: Ponto) => void }) {
  useMapEvents({ click: (e) => aoClicar({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}
