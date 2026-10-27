import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet';
import { useSearchParams } from 'react-router-dom';
import { api, type Bombona, type Ponto, type Status } from '../api.ts';
import { destaqueDe, iconeBombona, iconePatio } from '../componentes/icones.ts';
import { MarcadorAnimado } from '../componentes/MarcadorAnimado.tsx';
import { Bateria, SeloAlerta, SeloStatus } from '../componentes/Selos.tsx';
import { distancia, rotuloStatus, tempoRelativo } from '../formato.ts';
import { useMonitoramento } from '../monitoramento.tsx';
import { PainelBombona } from './PainelBombona.tsx';

type Filtro = Status | 'ALERTA' | null;

const CIANORTE: [number, number] = [-23.66, -52.64];
const LARGURA_PAINEL = 400;

/** Peso para ordenar a lista: o que precisa de atenção vem primeiro. */
function prioridade(b: Bombona) {
  const destaque = destaqueDe(b);
  if (destaque === 'critico') return 0;
  if (destaque === 'aviso') return 1;
  if (destaque === 'sinal') return 2;
  if (b.status === 'EM_ROTA') return 3;
  return b.alertasAbertos.length ? 4 : 5;
}

const referenciaDe = (b: Bombona) => b.localEsperado ?? b.destino;

export function Mapa() {
  const { bombonas, clientes, config, carregado, agora } = useMonitoramento();
  const [params, setParams] = useSearchParams();
  const selecionada = params.get('b');
  const clienteFocado = Number(params.get('c')) || null;
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>(null);

  const todas = useMemo(() => Object.values(bombonas), [bombonas]);
  const contagem = useMemo(() => {
    const c: Record<string, number> = { ALERTA: 0, PATIO: 0, EM_ROTA: 0, EM_CLIENTE: 0, EXTRAVIADA: 0 };
    for (const b of todas) {
      c[b.status]++;
      if (b.alertasAbertos.length) c.ALERTA++;
    }
    return c;
  }, [todas]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return todas
      .filter((b) => (filtro === 'ALERTA' ? b.alertasAbertos.length > 0 : !filtro || b.status === filtro))
      .filter(
        (b) =>
          !termo ||
          b.codigo.toLowerCase().includes(termo) ||
          b.cliente?.nome.toLowerCase().includes(termo) ||
          b.cliente?.cidade.toLowerCase().includes(termo),
      )
      .sort((a, b) => prioridade(a) - prioridade(b) || a.codigo.localeCompare(b.codigo));
  }, [todas, filtro, busca]);

  const selecionar = (codigo: string | null) => setParams(codigo ? { b: codigo } : {}, { replace: true });

  return (
    <div className="mapa-pagina">
      <aside className="lista">
        <div className="lista__topo">
          <input
            className="campo"
            type="search"
            placeholder="Buscar código, cliente ou cidade"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <div className="filtros" role="group" aria-label="Filtrar por situação">
            {([null, 'ALERTA', 'EM_CLIENTE', 'EM_ROTA', 'PATIO', 'EXTRAVIADA'] as Filtro[]).map((f) => (
              <button
                key={f ?? 'TODAS'}
                className={`filtro ${filtro === f ? 'filtro--ativo' : ''} ${f ? `filtro--${f}` : ''}`}
                onClick={() => setFiltro(f)}
              >
                {f === null ? 'Todas' : f === 'ALERTA' ? 'Com alerta' : rotuloStatus[f]}
                <span className="filtro__n">{f === null ? todas.length : contagem[f]}</span>
              </button>
            ))}
          </div>
        </div>
        <ul className="lista__itens">
          {!carregado && <li className="lista__vazio">Carregando…</li>}
          {carregado && lista.length === 0 && <li className="lista__vazio">Nenhuma bombona encontrada.</li>}
          {lista.map((b) => (
            <li key={b.codigo}>
              <button
                className={`item ${selecionada === b.codigo ? 'item--selecionado' : ''} ${destaqueDe(b) ? `item--${destaqueDe(b)}` : ''}`}
                onClick={() => selecionar(selecionada === b.codigo ? null : b.codigo)}
              >
                <span className="item__linha">
                  <strong className="item__codigo">{b.codigo}</strong>
                  <SeloStatus status={b.status} />
                </span>
                <span className="item__onde">
                  {b.status === 'EM_ROTA'
                    ? `→ ${b.destino?.nome} · faltam ${distancia(b.distanciaM)}`
                    : b.status === 'PATIO'
                      ? 'Pátio Bio Óleo'
                      : `${b.cliente?.nome} · ${b.cliente?.cidade}`}
                </span>
                <span className="item__linha item__linha--meta">
                  <Bateria nivel={b.bateria} />
                  <span className="item__sinal">sinal {tempoRelativo(b.ultimoSinal, agora)}</span>
                </span>
                {b.alertasAbertos.length > 0 && (
                  <span className="item__alertas">
                    {b.alertasAbertos.map((t) => (
                      <SeloAlerta key={t} tipo={t} />
                    ))}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="mapa-area">
        <MapContainer center={CIANORTE} zoom={11} zoomControl={false} className="mapa">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ZoomControl position="topleft" />

          {config && (
            <>
              <Circle center={config.patio} radius={config.patio.raioM} pathOptions={{ className: 'cerca cerca--patio' }} />
              <Marker position={config.patio} icon={iconePatio} zIndexOffset={-500}>
                <Tooltip direction="top" offset={[0, -16]}>
                  <strong>{config.patio.nome}</strong>
                  <br />
                  {config.patio.endereco}
                </Tooltip>
              </Marker>
            </>
          )}

          {clientes.map((c) => (
            <Circle
              key={c.id}
              center={c}
              radius={c.raioM}
              pathOptions={{ className: `cerca cerca--risco-${c.risco} ${clienteFocado === c.id ? 'cerca--focada' : ''}` }}
            >
              <Tooltip direction="top">
                <strong>{c.nome}</strong>
                <br />
                {c.cidade} · cerca de {c.raioM} m
              </Tooltip>
            </Circle>
          ))}

          {/* Deslocamento de quem saiu da cerca: do ponto esperado até onde a bombona está. */}
          {todas
            .filter((b) => b.posicao && b.localEsperado && (b.status === 'EXTRAVIADA' || b.alertasAbertos.includes('FORA_DA_AREA')))
            .map((b) => (
              <Polyline
                key={`desvio-${b.codigo}`}
                positions={[b.localEsperado!, b.posicao!]}
                pathOptions={{ className: `linha-desvio ${b.status === 'EXTRAVIADA' ? 'linha-desvio--critico' : ''}` }}
              />
            ))}

          {selecionada && bombonas[selecionada] && <Trilha bombona={bombonas[selecionada]} />}

          {todas
            .filter((b) => b.posicao)
            .map((b) => (
              <MarcadorAnimado
                key={b.codigo}
                posicao={b.posicao!}
                icone={iconeBombona(b, b.codigo === selecionada)}
                zIndexOffset={b.codigo === selecionada ? 1000 : destaqueDe(b) ? 500 : 0}
                aoClicar={() => selecionar(b.codigo)}
              >
                <Tooltip direction="top" offset={[0, -14]}>
                  <strong>{b.codigo}</strong> · {rotuloStatus[b.status]}
                </Tooltip>
              </MarcadorAnimado>
            ))}

          <Enquadrar bombona={selecionada ? bombonas[selecionada] : undefined} cliente={clientes.find((c) => c.id === clienteFocado)} />
          <EnquadrarTudo pontos={clientes} />
        </MapContainer>

        <Legenda />
        {selecionada && bombonas[selecionada] && (
          <PainelBombona key={selecionada} codigo={selecionada} aoFechar={() => selecionar(null)} />
        )}
      </div>
    </div>
  );
}

/** Caminho percorrido pela bombona selecionada, atualizado ao vivo. */
function Trilha({ bombona }: { bombona: Bombona }) {
  const [pontos, setPontos] = useState<Ponto[]>([]);

  useEffect(() => {
    let ativo = true;
    api.trilha(bombona.codigo).then((t) => ativo && setPontos(t));
    return () => {
      ativo = false;
    };
  }, [bombona.codigo]);

  useEffect(() => {
    const p = bombona.posicao;
    if (!p) return;
    setPontos((atual) => {
      const ultimo = atual[atual.length - 1];
      return ultimo && ultimo.lat === p.lat && ultimo.lng === p.lng ? atual : [...atual, p];
    });
  }, [bombona.posicao]);

  const referencia = referenciaDe(bombona);
  return (
    <>
      {pontos.length > 1 && (
        <>
          <Polyline positions={pontos} pathOptions={{ className: 'trilha-contorno' }} />
          <Polyline positions={pontos} pathOptions={{ className: 'trilha' }} />
          <CircleMarker center={pontos[0]} radius={4} pathOptions={{ className: 'trilha-inicio' }} />
        </>
      )}
      {bombona.posicao && referencia && bombona.status === 'EM_ROTA' && (
        <Polyline positions={[bombona.posicao, referencia]} pathOptions={{ className: 'linha-destino' }} />
      )}
    </>
  );
}

/** Ajusta o mapa quando o operador escolhe uma bombona ou um cliente. */
function Enquadrar({ bombona, cliente }: { bombona?: Bombona; cliente?: { lat: number; lng: number } }) {
  const map = useMap();
  const codigo = bombona?.codigo;
  const ultimo = useRef<string | null>(null);

  useEffect(() => {
    if (!bombona?.posicao || ultimo.current === codigo) return;
    ultimo.current = codigo ?? null;
    const referencia = referenciaDe(bombona);
    const paddingDireita = window.innerWidth > 900 ? LARGURA_PAINEL + 32 : 24;
    if (referencia && (bombona.distanciaM ?? 0) > 200) {
      map.fitBounds(L.latLngBounds([bombona.posicao, referencia]), {
        paddingTopLeft: [40, 40],
        paddingBottomRight: [paddingDireita, 40],
        maxZoom: 16,
      });
    } else {
      map.flyTo(bombona.posicao, Math.max(map.getZoom(), 16), { duration: 0.8 });
    }
    // Só reenquadra ao trocar de bombona, não a cada leitura.
  }, [codigo, Boolean(bombona?.posicao)]);

  useEffect(() => {
    if (!codigo) ultimo.current = null;
  }, [codigo]);

  // Segue a bombona selecionada quando ela sai da área visível.
  const posicao = bombona?.posicao;
  useEffect(() => {
    if (!posicao || ultimo.current !== codigo) return;
    const paddingDireita = window.innerWidth > 900 ? LARGURA_PAINEL + 32 : 24;
    map.panInside(posicao, { paddingTopLeft: [60, 60], paddingBottomRight: [paddingDireita, 60] });
  }, [posicao, codigo, map]);

  // A lista de clientes é recarregada a cada evento; só voa quando o cliente focado muda de fato.
  const clienteLat = cliente?.lat;
  const clienteLng = cliente?.lng;
  useEffect(() => {
    if (clienteLat !== undefined && clienteLng !== undefined) map.flyTo([clienteLat, clienteLng], 16, { duration: 0.8 });
  }, [clienteLat, clienteLng, map]);

  return null;
}

/** Na primeira carga, mostra todos os clientes. */
function EnquadrarTudo({ pontos }: { pontos: Ponto[] }) {
  const map = useMap();
  const feito = useRef(false);
  const [params] = useSearchParams();
  useEffect(() => {
    if (feito.current || pontos.length === 0) return;
    feito.current = true;
    if (params.get('b') || params.get('c')) return;
    map.fitBounds(L.latLngBounds(pontos.map((p) => [p.lat, p.lng])), { padding: [40, 40] });
  }, [pontos, map, params]);
  return null;
}

function Legenda() {
  return (
    <div className="legenda" aria-label="Legenda">
      {(['EM_CLIENTE', 'EM_ROTA', 'PATIO', 'EXTRAVIADA'] as Status[]).map((s) => (
        <span key={s} className="legenda__item">
          <span className={`legenda__ponto legenda__ponto--${s}`} />
          {rotuloStatus[s]}
        </span>
      ))}
      <span className="legenda__item">
        <span className="legenda__cerca" />
        Cerca do cliente
      </span>
    </div>
  );
}
