import L from 'leaflet';
import type { Bombona } from '../api.ts';

/** Desenho da bombona usado nos pinos do mapa. */
const SVG_BOMBONA = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="3" fill="currentColor"/><rect x="9.5" y="2" width="5" height="3" rx="1" fill="currentColor"/><path d="M5 9.5h14M5 15.5h14" stroke="#fff" stroke-opacity=".75" stroke-width="1.5"/></svg>`;

const SVG_FABRICA = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V10l5 3V10l5 3V6l3-3h3v18z" fill="currentColor"/><path d="M7 17h2M11 17h2M15 17h2" stroke="#fff" stroke-width="1.5"/></svg>`;

const cache = new Map<string, L.DivIcon>();

export type Destaque = 'critico' | 'aviso' | 'sinal' | null;

export function destaqueDe(b: Bombona): Destaque {
  if (b.status === 'EXTRAVIADA' || b.alertasAbertos.includes('EXTRAVIO')) return 'critico';
  if (b.alertasAbertos.includes('FORA_DA_AREA')) return 'aviso';
  if (b.alertasAbertos.includes('SEM_SINAL')) return 'sinal';
  return null;
}

/** Ícones são reaproveitados para o Leaflet não recriar o DOM a cada atualização. */
export function iconeBombona(b: Bombona, selecionada: boolean) {
  const destaque = destaqueDe(b);
  const chave = `${b.status}|${destaque}|${selecionada}`;
  let icone = cache.get(chave);
  if (!icone) {
    const classes = ['pino', `pino--${b.status}`, destaque && `pino--${destaque}`, selecionada && 'pino--selecionado'].filter(Boolean).join(' ');
    const tamanho = selecionada ? 40 : 30;
    icone = L.divIcon({
      className: '',
      html: `<div class="${classes}">${SVG_BOMBONA}</div>`,
      iconSize: [tamanho, tamanho],
      iconAnchor: [tamanho / 2, tamanho / 2],
    });
    cache.set(chave, icone);
  }
  return icone;
}

export const iconePatio = L.divIcon({
  className: '',
  html: `<div class="pino-patio">${SVG_FABRICA}</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});
