/**
 * Furgões do simulador: cada roteiro EM_ANDAMENTO do servidor vira um furgão que sai do pátio, passa pelas paradas
 * na ordem (trocando bombonas em cada uma) e volta ao pátio, pelas ruas.
 *
 * Uma única consulta ao OSRM por roteiro (pátio → paradas → pátio). O passo é ajustado para a rota inteira caber em
 * ~DURACAO_ROTEIRO_S, contando a pausa de cada parada. O que o furgão acha no cliente vem de quem o chama (o
 * simulador é quem sabe o que foi vendido); os litros são gerados aqui, em torno do esperado do cliente.
 */

import { distanciaM, comprimentoM, passoDaViagem, type Ponto } from './percurso.ts';

export type StatusParada = 'PENDENTE' | 'FEITA' | 'NAO_ATENDIDA';
export type ParadaRemota = {
  id: number;
  ordem: number | null;
  status: StatusParada;
  clienteId: number;
  nome: string;
  lat: number;
  lng: number;
  litrosEsperados: number | null;
  /** As bombonas que a troca do servidor procura no cliente, com a capacidade de cada uma (vazia se não PENDENTE). */
  procuradas: { codigo: string; capacidadeL: number }[];
};
export type RoteiroRemoto = { id: number; numero: number; paradas: ParadaRemota[]; bombonas: string[] };
export type Tempo = { duracaoS: number; pausaMs: number; tickMs: number };
type Encontrada = { codigo: string; litros: number };

// ---------- funções puras ----------

/**
 * Litros de uma bombona levada na troca: em torno do esperado do cliente (±15%) e, 1 vez em 12, abaixo de 40% dele
 * (para a RN18 aparecer). Sem histórico, 70% da capacidade ±15%. Sempre inteiro de 0 à capacidade.
 */
export function gerarLitros(esperado: number | null, capacidade: number, rnd: () => number): number {
  const variar = (base: number) => base * (1 + (rnd() * 2 - 1) * 0.15);
  let litros: number;
  if (esperado === null) litros = variar(capacidade * 0.7);
  else if (rnd() < 1 / 12) litros = Math.floor(esperado * 0.4 * rnd());
  else litros = variar(esperado);
  return Math.max(0, Math.min(capacidade, Math.round(litros)));
}

/**
 * Metros por tick do furgão: `passoDaViagem` com o limite de ticks da duração alvo menos as pausas das paradas
 * (pelo menos 1 tick).
 */
export function passoDoRoteiro(distanciaM: number, passoBaseM: number, nParadas: number, tempo: Tempo): number {
  const ticksMax = Math.max(1, (tempo.duracaoS * 1000 - nParadas * tempo.pausaMs) / tempo.tickMs);
  return passoDaViagem(distanciaM, passoBaseM, ticksMax);
}

/**
 * Para cada parada, o índice do ponto da rota mais próximo dela. A busca de cada parada começa no índice da
 * anterior, então os índices crescem (a volta pelo mesmo caminho não "rouba" a parada da ida); empate fica com o
 * primeiro.
 */
export function indicesDasParadas(pontosDaRota: Ponto[], paradas: Ponto[]): number[] {
  const indices: number[] = [];
  let de = 0;
  for (const parada of paradas) {
    let melhor = de;
    let menor = Infinity;
    for (let i = de; i < pontosDaRota.length; i++) {
      const d = distanciaM(pontosDaRota[i], parada);
      if (d < menor) {
        menor = d;
        melhor = i;
      }
    }
    indices.push(melhor);
    de = melhor;
  }
  return indices;
}

const arredondar = (p: Ponto): [number, number] => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6];

/**
 * Desenho enviado ao servidor (o corpo do POST tem limite de 64 kB): no máximo `max` pontos [lat, lng], mantendo as
 * pontas e os pontos das paradas (`fixos`) e espalhando o resto por igual. O furgão anda pela geometria inteira.
 */
export function simplificarTrajeto(pontos: Ponto[], fixos: number[], max = 2000): [number, number][] {
  if (pontos.length <= max) return pontos.map(arredondar);
  const manter = new Set([0, pontos.length - 1, ...fixos.filter((i) => i >= 0 && i < pontos.length)]);
  const livres = max - manter.size;
  const intervalo = (pontos.length - 1) / (livres + 1);
  for (let k = 1; k <= livres; k++) manter.add(Math.round(k * intervalo));
  return [...manter]
    .sort((a, b) => a - b)
    .slice(0, max)
    .map((i) => arredondar(pontos[i]));
}

/**
 * Anda `passo` metros pela rota a partir do ponto `proximo` (o próximo a alcançar), sem passar do ponto `limite`.
 * `chegou` quando o `limite` foi alcançado.
 */
export function avancar(pontos: Ponto[], posicao: Ponto, proximo: number, passo: number, limite: number) {
  let resta = passo;
  while (proximo <= limite && proximo < pontos.length) {
    const falta = distanciaM(posicao, pontos[proximo]);
    if (falta > resta) {
      const f = resta / falta;
      posicao = { lat: posicao.lat + (pontos[proximo].lat - posicao.lat) * f, lng: posicao.lng + (pontos[proximo].lng - posicao.lng) * f };
      return { posicao, proximo, chegou: false };
    }
    posicao = pontos[proximo];
    resta -= falta;
    proximo++;
  }
  return { posicao, proximo, chegou: true };
}

/**
 * O corpo da troca: das bombonas que o servidor procura no cliente, as que estão lá de fato (`estaLa`, quem sabe é o
 * simulador), com litros gerados pela capacidade de cada uma.
 */
export function montarEncontradas(
  parada: Pick<ParadaRemota, 'litrosEsperados' | 'procuradas'>,
  estaLa: (codigo: string) => boolean,
  rnd: () => number,
): Encontrada[] {
  return parada.procuradas
    .filter((b) => estaLa(b.codigo))
    .map((b) => ({ codigo: b.codigo, litros: gerarLitros(parada.litrosEsperados, b.capacidadeL, rnd) }));
}

// ---------- OSRM ----------

/** Rota pelas ruas passando pelos pontos em ordem (uma consulta ao OSRM). */
export async function consultarOsrm(roteador: string, pontos: Ponto[], timeoutMs = 5000) {
  const coordenadas = pontos.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `${roteador}/route/v1/driving/${coordenadas}?overview=full&geometries=geojson`;
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const corpo = (await r.json()) as { routes?: { distance: number; geometry: { coordinates: [number, number][] } }[] };
  const rota = corpo.routes?.[0];
  if (!rota?.geometry.coordinates.length) throw new Error('nenhuma rota encontrada');
  return { pontos: rota.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })), distanciaM: rota.distance };
}

// ---------- frota ----------

export type OpcoesFrota = {
  api: string;
  token: string;
  roteador: string;
  patio: Ponto;
  tempo: Tempo;
  passoBaseM: number;
  esperaEntreTentativasMs: number;
  /** Se a bombona (por código) está de fato no cliente: o simulador é quem sabe o que foi vendido. */
  estaNoCliente: (codigo: string) => boolean;
};

type Tentativa = { ocupado: boolean; proximaEm: number };

type Furgao = {
  roteiro: RoteiroRemoto;
  posicao: Ponto;
  emMovimento: boolean;
  planejando: Tentativa;
  rota?: {
    pontos: Ponto[];
    proximo: number;
    passo: number;
    /** Paradas ainda por fazer, em ordem, com o índice do ponto da rota onde o furgão para. */
    paradas: Array<{ indice: number; parada: ParadaRemota }>;
  };
  /** Desenho a reenviar ao servidor, se o envio falhou. */
  trajeto?: { corpo: string; tentativa: Tentativa };
  /** Parada onde o furgão está parado e os ticks de pausa que faltam antes da troca. */
  naParada?: number;
  pausa: number;
  /** Troca ou conclusão (POST) em andamento ou aguardando nova tentativa. */
  envio: Tentativa;
  concluido: boolean;
};

const novaTentativa = (): Tentativa => ({ ocupado: false, proximaEm: 0 });
const mensagem = (e: unknown) => {
  const erro = e as Error;
  return `${erro.message}${erro.cause ? `: ${(erro.cause as Error).message}` : ''}`;
};

export function criarFrota(op: OpcoesFrota) {
  const furgoes = new Map<number, Furgao>();
  const ticksDePausa = Math.max(1, Math.round(op.tempo.pausaMs / op.tempo.tickMs));

  const postar = (caminho: string, corpo: unknown) =>
    fetch(`${op.api}${caminho}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${op.token}` },
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    });

  const nome = (f: Furgao) => `Furgão ${f.roteiro.numero}`;

  /**
   * De onde o furgão sai: do pátio ou, se o simulador reiniciou no meio do roteiro, da última parada feita. As
   * paradas pendentes vêm na ordem.
   */
  function pontoDePartida(roteiro: RoteiroRemoto): Ponto {
    const feitas = roteiro.paradas.filter((p) => p.status === 'FEITA');
    const ultima = feitas[feitas.length - 1];
    return ultima ? { lat: ultima.lat, lng: ultima.lng } : op.patio;
  }

  async function enviarTrajeto(f: Furgao) {
    const t = f.trajeto;
    if (!t || t.tentativa.ocupado || Date.now() < t.tentativa.proximaEm) return;
    t.tentativa.ocupado = true;
    try {
      const r = await postar(`/roteiros/${f.roteiro.id}/trajeto`, t.corpo);
      if (!r.ok && r.status !== 404 && r.status !== 409) throw new Error(`HTTP ${r.status} ${await r.text()}`);
      if (f.trajeto === t) f.trajeto = undefined;
    } catch (e) {
      t.tentativa.ocupado = false;
      t.tentativa.proximaEm = Date.now() + op.esperaEntreTentativasMs;
      console.warn(`[${nome(f)}] envio do trajeto falhou (${mensagem(e)}); tentando de novo`);
    }
  }

  /** Uma consulta ao OSRM com partida → paradas pendentes → pátio. Sem resposta, espera e tenta de novo. */
  async function planejar(f: Furgao) {
    const plano = f.planejando;
    if (plano.ocupado || Date.now() < plano.proximaEm) return;
    plano.ocupado = true;
    const pendentes = f.roteiro.paradas.filter((p) => p.status === 'PENDENTE');
    const partida = f.posicao;
    try {
      const osrm = await consultarOsrm(op.roteador, [partida, ...pendentes, op.patio], 10_000);
      if (furgoes.get(f.roteiro.id) !== f) return;
      // Termina no próprio pátio, que pode ficar fora da rua.
      const pontos = [...osrm.pontos, op.patio];
      const indices = indicesDasParadas(pontos, pendentes);
      const passo = passoDoRoteiro(comprimentoM([partida, ...pontos]), op.passoBaseM, pendentes.length, op.tempo);
      f.rota = { pontos, proximo: 0, passo, paradas: pendentes.map((parada, i) => ({ indice: indices[i], parada })) };
      f.trajeto = {
        corpo: JSON.stringify({ pontos: simplificarTrajeto(pontos, indices), distanciaM: Math.round(osrm.distanciaM) }),
        tentativa: novaTentativa(),
      };
      const de = partida === op.patio ? 'do pátio' : 'da última parada feita';
      console.log(
        `[${nome(f)}] rota ${de}: ${pendentes.length} paradas, ${(osrm.distanciaM / 1000).toFixed(1)} km, ` +
          `${pontos.length} pontos pelas ruas, ${Math.round((passo * 1000) / op.tempo.tickMs)} m/s`,
      );
      void enviarTrajeto(f);
    } catch (e) {
      plano.ocupado = false;
      plano.proximaEm = Date.now() + op.esperaEntreTentativasMs;
      console.warn(`[${nome(f)}] rota falhou (${mensagem(e)}); tentando de novo`);
    }
  }

  /**
   * POST da troca ou da conclusão. 404/409 (já feita, roteiro encerrado) também encerram o passo. 400 (corpo
   * recusado) não melhora tentando de novo: segue como feito sem resultado (a parada vira NAO_ATENDIDA quando o
   * roteiro é concluído). 5xx e erro de rede tentam de novo.
   */
  async function enviar(f: Furgao, caminho: string, corpo: unknown, feito: (resposta: unknown) => void) {
    if (f.envio.ocupado || Date.now() < f.envio.proximaEm) return;
    f.envio.ocupado = true;
    try {
      const r = await postar(caminho, corpo);
      if (r.status === 400) {
        console.error(`[${nome(f)}] ${caminho}: recusado (HTTP 400) ${await r.text()}; seguindo sem resultado`);
        feito(null);
      } else if (r.status === 404 || r.status === 409) {
        console.warn(`[${nome(f)}] ${caminho}: HTTP ${r.status} ${await r.text()}`);
        feito(null);
      } else if (!r.ok) {
        throw new Error(`HTTP ${r.status} ${await r.text()}`);
      } else {
        feito(await r.json());
      }
      f.envio = novaTentativa();
    } catch (e) {
      f.envio.ocupado = false;
      f.envio.proximaEm = Date.now() + op.esperaEntreTentativasMs;
      console.warn(`[${nome(f)}] ${caminho} falhou (${mensagem(e)}); tentando de novo`);
    }
  }

  function trocar(f: Furgao, alvo: { parada: ParadaRemota }) {
    // A parada no estado mais recente do servidor (as procuradas refletem o que ele procura agora).
    const parada = f.roteiro.paradas.find((p) => p.id === alvo.parada.id) ?? alvo.parada;
    const encontradas = montarEncontradas(parada, op.estaNoCliente, Math.random);
    void enviar(f, `/roteiros/${f.roteiro.id}/paradas/${parada.id}/troca`, { encontradas }, (resposta) => {
      if (f.rota?.paradas[0]?.parada.id === parada.id) f.rota.paradas.shift();
      const r = (resposta as { resultado?: { deixadas: string[]; levadas: Encontrada[]; naoEncontradas: { codigo: string }[] } } | null)
        ?.resultado;
      if (!r) return;
      const levadas = r.levadas.map((b) => `${b.codigo} (${b.litros} L)`).join(', ') || 'nada';
      const faltaram = r.naoEncontradas.length ? `; não encontradas: ${r.naoEncontradas.map((b) => b.codigo).join(', ')}` : '';
      console.log(`[${nome(f)}] parada em ${parada.nome}: deixou ${r.deixadas.length}, levou ${levadas}${faltaram}`);
    });
  }

  /** Um tick do furgão: pausa na parada e troca, volta ao pátio e conclusão, ou anda. */
  function andar(f: Furgao) {
    const rota = f.rota!;
    const alvo = rota.paradas[0];
    if (alvo && rota.proximo > alvo.indice) {
      if (f.naParada !== alvo.parada.id) {
        f.naParada = alvo.parada.id;
        f.pausa = ticksDePausa;
      }
      if (f.pausa > 0) return void f.pausa--;
      return trocar(f, alvo);
    }
    if (!alvo && rota.proximo >= rota.pontos.length) {
      return void enviar(f, `/roteiros/${f.roteiro.id}/concluir`, {}, () => {
        f.concluido = true;
        console.log(`[${nome(f)}] de volta ao pátio: roteiro concluído`);
      });
    }
    const limite = alvo ? alvo.indice : rota.pontos.length - 1;
    const antes = f.posicao;
    const r = avancar(rota.pontos, f.posicao, rota.proximo, rota.passo, limite);
    f.posicao = r.posicao;
    rota.proximo = r.proximo;
    f.emMovimento = distanciaM(antes, f.posicao) > 0;
  }

  return {
    /**
     * Um ciclo da frota com o estado do servidor: cria o furgão de cada roteiro novo, esquece os que saíram da lista
     * e, fora da pausa, anda. Devolve os envios de posição do ciclo.
     */
    ciclo(roteiros: RoteiroRemoto[], pausado: boolean): Promise<void>[] {
      const ativos = new Set(roteiros.map((r) => r.id));
      for (const id of furgoes.keys()) if (!ativos.has(id)) furgoes.delete(id);

      const envios: Promise<void>[] = [];
      for (const roteiro of roteiros) {
        let f = furgoes.get(roteiro.id);
        if (!f) {
          f = {
            roteiro,
            posicao: pontoDePartida(roteiro),
            emMovimento: false,
            planejando: novaTentativa(),
            pausa: 0,
            envio: novaTentativa(),
            concluido: false,
          };
          furgoes.set(roteiro.id, f);
        }
        f.roteiro = roteiro;
        f.emMovimento = false;
        if (f.concluido) continue;
        if (!f.rota) {
          void planejar(f);
          continue;
        }
        if (f.trajeto) void enviarTrajeto(f);
        if (pausado || f.envio.ocupado) continue;
        andar(f);
        if (f.emMovimento) {
          const furgao = f;
          envios.push(
            postar(`/roteiros/${roteiro.id}/posicao`, furgao.posicao)
              .then(async (r) => {
                if (!r.ok && r.status !== 409) console.warn(`[${nome(furgao)}] posição recusada: HTTP ${r.status} ${await r.text()}`);
              })
              .catch((e) => console.warn(`[${nome(furgao)}] falha no envio da posição: ${mensagem(e)}`)),
          );
        }
      }
      return envios;
    },

    /** Onde está o furgão do roteiro (as bombonas dentro dele vão junto). */
    posicao(roteiroId: number): { posicao: Ponto; emMovimento: boolean } | undefined {
      const f = furgoes.get(roteiroId);
      return f && { posicao: f.posicao, emMovimento: f.emMovimento };
    },
  };
}
