/**
 * Simulador dos rastreadores das bombonas.
 *
 * Faz o papel do hardware que ainda não existe: cada bombona "envia" a própria posição pelo
 * contrato público (POST /api/telemetria, com o token do dispositivo), como um aparelho real faria.
 *
 * Para saber onde cada bombona deveria estar e quais cenários o painel pediu, ele consulta o canal
 * de controle da demonstração (GET /api/simulacao/estado). Esse canal não existe num cenário real.
 */

import { comprimentoM, distanciaM, M_POR_GRAU_LAT, mPorGrauLng, passoDaViagem, type Ponto } from './percurso.ts';

type Local = Ponto & { nome: string; raioM: number };
type Status = 'PATIO' | 'EM_ROTA' | 'EM_CLIENTE' | 'EXTRAVIADA';

type DispositivoRemoto = {
  dispositivoId: string;
  token: string;
  bombona: string;
  status: Status;
  posicao: Ponto | null;
  bateria: number | null;
  alvo: Local | null;
};
type Comando = { id: number; bombona: string; tipo: 'VENDA' | 'DEVOLUCAO' | 'SEM_SINAL' | 'BATERIA_FRACA' };

type Aparelho = {
  remoto: DispositivoRemoto;
  posicao: Ponto;
  bateria: number;
  /** Alguém "comprou" a bombona e está levando embora. */
  desvio?: boolean;
  /** A bombona está sendo devolvida ao local esperado. */
  devolvendo?: boolean;
  caladoAte?: number;
  ticksParado: number;
  /** Caminho pelas ruas da viagem atual (pontos que ainda faltam). */
  rota?: { chave: string; pontos: Ponto[]; passo: number };
  /** Busca de rota em andamento ou aguardando nova tentativa. */
  planejando?: { chave: string; ocupado: boolean; proximaEm: number };
};

/** Um deslocamento pelas ruas: furgão, comprador ou devolução. */
type Viagem = { chave: string; doFurgao: boolean; nome: string; passo: number; buscar: () => Promise<Ponto[]> };

const API = process.env.API_URL ?? 'http://localhost:3333/api';
const TOKEN_SIMULADOR = process.env.SIM_TOKEN ?? 'sim-demo-token';
const TICK_MS = Number(process.env.SIM_TICK_MS) || 250;
/** Bombona parada manda sinal uma vez por segundo; em movimento, a cada tick. */
const TICKS_ENTRE_SINAIS_PARADA = Math.max(1, Math.round(1000 / TICK_MS));
/** Quanto anda por tick (tempo da demonstração é acelerado): 100 m/s no furgão, 73 m/s na venda. */
const PASSO_FURGAO_M = (100 * TICK_MS) / 1000;
/** Teto de duração de uma viagem do furgão: viagens longas aceleram para caber nele. */
const DURACAO_MAX_VIAGEM_S = 90;
const PASSO_VENDA_M = (73 * TICK_MS) / 1000;
/** Consumo de bateria por tick, em pontos percentuais. */
const CONSUMO_MOVIMENTO = (0.05 / 3000) * TICK_MS;
const CONSUMO_PARADA = (0.01 / 3000) * TICK_MS;
/** Serviço de rotas (OSRM). Toda viagem anda pelas ruas: sem resposta dele, a bombona espera e tenta de novo. */
const ROTEADOR = process.env.ROTEADOR_URL ?? 'https://router.project-osrm.org';
const ESPERA_ENTRE_TENTATIVAS_MS = 2000;
/** O destino da venda é sorteado até dar num lugar a pelo menos esta distância, sem volta absurda pelas ruas. */
const VENDA_DISTANCIA_MINIMA_M = 3000;
const VENDA_DESVIO_MAXIMO = 3;
const VENDA_SORTEIOS = 5;
/** Minutos entre "vendas" automáticas de bombonas aleatórias (0 desliga). */
const AUTO_VENDA_MIN = Number(process.env.SIM_AUTO_VENDA_MIN) || 0;

const aparelhos = new Map<string, Aparelho>();
let silencioMs = 70_000;

// ---------- geometria ----------

function deslocar(p: Ponto, norteM: number, lesteM: number): Ponto {
  return { lat: p.lat + norteM / M_POR_GRAU_LAT, lng: p.lng + lesteM / mPorGrauLng(p.lat) };
}

/** Anda `passo` metros pelo caminho, consumindo os pontos alcançados. Devolve true ao fim do caminho. */
function seguir(ap: Aparelho, pontos: Ponto[], passo: number) {
  while (pontos.length) {
    const falta = distanciaM(ap.posicao, pontos[0]);
    if (falta > passo) {
      const f = passo / falta;
      ap.posicao = { lat: ap.posicao.lat + (pontos[0].lat - ap.posicao.lat) * f, lng: ap.posicao.lng + (pontos[0].lng - ap.posicao.lng) * f };
      return false;
    }
    ap.posicao = pontos.shift()!;
    passo -= falta;
  }
  return true;
}

// ---------- comunicação ----------

async function buscarEstado() {
  const r = await fetch(`${API}/simulacao/estado`, { headers: { Authorization: `Bearer ${TOKEN_SIMULADOR}` } });
  if (!r.ok) throw new Error(`estado: HTTP ${r.status}`);
  return (await r.json()) as { dispositivos: DispositivoRemoto[]; comandos: Comando[] };
}

async function consultarRota(de: Ponto, para: Ponto) {
  const url = `${ROTEADOR}/route/v1/driving/${de.lng},${de.lat};${para.lng},${para.lat}?overview=full&geometries=geojson`;
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const corpo = (await r.json()) as { routes?: { distance: number; geometry: { coordinates: [number, number][] } }[] };
  const rota = corpo.routes?.[0];
  if (!rota?.geometry.coordinates.length) throw new Error('nenhuma rota encontrada');
  return { pontos: rota.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })), distanciaM: rota.distance };
}

/** Caminho pelas ruas de `de` até `para`. Termina no próprio alvo, que pode ficar fora da rua. */
async function buscarRota(de: Ponto, para: Ponto): Promise<Ponto[]> {
  return [...(await consultarRota(de, para)).pontos, para];
}

/** Para onde o comprador leva a bombona: de 4 a 9 km dali, terminando na rua mais próxima do ponto sorteado. */
async function buscarRotaDeVenda(de: Ponto): Promise<Ponto[]> {
  let reserva: Ponto[] | undefined;
  let erro: unknown;
  for (let i = 0; i < VENDA_SORTEIOS; i++) {
    const angulo = Math.random() * 2 * Math.PI;
    const distancia = 4000 + Math.random() * 5000;
    try {
      const { pontos, distanciaM: pelasRuas } = await consultarRota(de, deslocar(de, Math.cos(angulo) * distancia, Math.sin(angulo) * distancia));
      const reta = distanciaM(de, pontos[pontos.length - 1]);
      if (reta >= VENDA_DISTANCIA_MINIMA_M) {
        if (pelasRuas <= reta * VENDA_DESVIO_MAXIMO) return pontos;
        reserva = pontos;
      }
    } catch (e) {
      erro = e;
    }
  }
  if (reserva) return reserva;
  throw erro ?? new Error('nenhum destino de venda encontrado');
}

/** A viagem que a bombona deveria estar fazendo agora, se houver. */
function viagemAtual(ap: Aparelho): Viagem | null {
  const { status, alvo } = ap.remoto;
  if (status === 'EM_ROTA' && alvo) {
    return { chave: `furgao:${alvo.lat},${alvo.lng}`, doFurgao: true, nome: alvo.nome, passo: PASSO_FURGAO_M, buscar: () => buscarRota(ap.posicao, alvo) };
  }
  if (ap.desvio) return { chave: 'venda', doFurgao: false, nome: 'o comprador', passo: PASSO_VENDA_M, buscar: () => buscarRotaDeVenda(ap.posicao) };
  if (ap.devolvendo && alvo) {
    return { chave: `devolucao:${alvo.lat},${alvo.lng}`, doFurgao: false, nome: alvo.nome, passo: PASSO_VENDA_M, buscar: () => buscarRota(ap.posicao, alvo) };
  }
  return null;
}

/** Garante a rota da viagem. Não segura o ciclo: enquanto a rota não chega, a bombona espera no lugar. */
async function planejarViagem(ap: Aparelho, viagem: Viagem) {
  if (ap.rota?.chave === viagem.chave) return;
  if (ap.planejando?.chave !== viagem.chave) ap.planejando = { chave: viagem.chave, ocupado: false, proximaEm: 0 };
  const plano = ap.planejando;
  if (plano.ocupado || Date.now() < plano.proximaEm) return;
  plano.ocupado = true;
  try {
    const pontos = await viagem.buscar();
    if (ap.planejando !== plano) return;
    const passo = viagem.doFurgao
      ? passoDaViagem(comprimentoM([ap.posicao, ...pontos]), viagem.passo, (DURACAO_MAX_VIAGEM_S * 1000) / TICK_MS)
      : viagem.passo;
    ap.rota = { chave: viagem.chave, pontos, passo };
    ap.planejando = undefined;
    const veloc = passo > viagem.passo ? `; ${Math.round((passo * 1000) / TICK_MS)} m/s` : '';
    console.log(`[${ap.remoto.bombona}] rota até ${viagem.nome}: ${pontos.length} pontos pelas ruas${veloc}`);
  } catch (e) {
    if (ap.planejando !== plano) return;
    plano.ocupado = false;
    plano.proximaEm = Date.now() + ESPERA_ENTRE_TENTATIVAS_MS;
    const erro = e as Error;
    console.warn(`[${ap.remoto.bombona}] rota até ${viagem.nome} falhou (${erro.message}${erro.cause ? `: ${(erro.cause as Error).message}` : ''}); tentando de novo`);
  }
}

/** Exatamente o que um rastreador real enviaria (docs/contrato-dispositivo.md). */
async function enviarLeitura(ap: Aparelho, emMovimento: boolean) {
  // Sem ruído de GPS: leituras frequentes fariam o pino tremer e a trilha sair da rua.
  const { lat, lng } = ap.posicao;
  const precisao = emMovimento ? 15 : 6 + Math.random() * 6;
  const r = await fetch(`${API}/telemetria`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ap.remoto.token}` },
    body: JSON.stringify({ lat, lng, precisao: Math.round(precisao), bateria: Math.round(ap.bateria * 10) / 10, registradoEm: new Date().toISOString() }),
  });
  if (r.status !== 202) console.warn(`[${ap.remoto.bombona}] leitura recusada: HTTP ${r.status} ${await r.text()}`);
}

// ---------- cenários ----------

function aplicarComando(c: Comando) {
  const ap = [...aparelhos.values()].find((a) => a.remoto.bombona === c.bombona);
  if (!ap) return;
  switch (c.tipo) {
    case 'VENDA':
      ap.desvio = true;
      ap.devolvendo = false;
      ap.rota = undefined;
      console.log(`[${c.bombona}] cenário VENDA: alguém está levando a bombona pelas ruas`);
      break;
    case 'DEVOLUCAO':
      ap.desvio = false;
      ap.devolvendo = true;
      console.log(`[${c.bombona}] cenário DEVOLUÇÃO: voltando para ${ap.remoto.alvo?.nome ?? 'o local esperado'}`);
      break;
    case 'SEM_SINAL':
      ap.caladoAte = Date.now() + silencioMs;
      console.log(`[${c.bombona}] cenário SEM SINAL: rastreador calado por ${Math.round(silencioMs / 1000)} s`);
      break;
    case 'BATERIA_FRACA':
      ap.bateria = 14;
      console.log(`[${c.bombona}] cenário BATERIA FRACA: 14%`);
      break;
  }
}

function sortearVenda() {
  const candidatas = [...aparelhos.values()].filter((a) => a.remoto.status === 'EM_CLIENTE' && !a.desvio);
  const escolhida = candidatas[Math.floor(Math.random() * candidatas.length)];
  if (escolhida) aplicarComando({ id: 0, bombona: escolhida.remoto.bombona, tipo: 'VENDA' });
}

// ---------- ciclo ----------

function sincronizar(remotos: DispositivoRemoto[]) {
  for (const remoto of remotos) {
    const ap = aparelhos.get(remoto.dispositivoId);
    if (!ap) {
      aparelhos.set(remoto.dispositivoId, {
        remoto,
        posicao: remoto.posicao ?? remoto.alvo ?? { lat: -23.66, lng: -52.6 },
        bateria: remoto.bateria ?? 100,
        ticksParado: Math.floor(Math.random() * TICKS_ENTRE_SINAIS_PARADA),
      });
      continue;
    }
    // Coletada pelo furgão: quem estava com a bombona perdeu ela.
    if (remoto.status === 'EM_ROTA' && ap.remoto.status !== 'EM_ROTA') {
      ap.desvio = false;
      ap.devolvendo = false;
    }
    // Chegou ao pátio: o rastreador é recarregado e já avisa a nova bateria na próxima leitura.
    if (remoto.status === 'PATIO' && ap.remoto.status !== 'PATIO') {
      ap.bateria = 100;
      ap.ticksParado = -1;
      console.log(`[${remoto.bombona}] chegou ao pátio: rastreador recarregado (100%)`);
    }
    ap.remoto = remoto;
  }
}

/** Anda pela rota da viagem. Sem viagem, termina o caminho: a chegada é confirmada na borda da cerca, antes do alvo. */
function mover(ap: Aparelho, viagem: Viagem | null) {
  const rota = ap.rota;
  if (!rota) return false;
  const emViagem = viagem?.chave === rota.chave;
  if (!emViagem && viagem) return false;
  const andando = rota.pontos.length > 0;
  if (seguir(ap, rota.pontos, rota.passo)) {
    if (emViagem && ap.devolvendo) ap.devolvendo = false;
    if (!viagem) ap.rota = undefined;
  }
  return andando;
}

async function tick() {
  const { dispositivos, comandos } = await buscarEstado();
  sincronizar(dispositivos);
  comandos.forEach(aplicarComando);

  const envios: Promise<void>[] = [];
  for (const ap of aparelhos.values()) {
    const viagem = viagemAtual(ap);
    if (viagem) void planejarViagem(ap, viagem);
    else ap.planejando = undefined;

    if (ap.caladoAte && ap.caladoAte > Date.now()) continue;
    if (ap.caladoAte) {
      ap.caladoAte = undefined;
      console.log(`[${ap.remoto.bombona}] sinal de volta`);
    }

    const emMovimento = mover(ap, viagem);
    ap.bateria = Math.max(0, ap.bateria - (emMovimento ? CONSUMO_MOVIMENTO : CONSUMO_PARADA));
    // A leitura repetida logo ao parar marca o fim do percurso, mesmo que a bombona saia de novo em menos de 1 s.
    const acabouDeParar = !emMovimento && ap.ticksParado === 0;
    ap.ticksParado = emMovimento ? 0 : ap.ticksParado + 1;
    if (emMovimento || acabouDeParar || ap.ticksParado % TICKS_ENTRE_SINAIS_PARADA === 0) {
      envios.push(enviarLeitura(ap, emMovimento).catch((e) => console.warn(`[${ap.remoto.bombona}] falha no envio: ${e.message}`)));
    }
  }
  await Promise.all(envios);
}

async function aguardarApi() {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const config = (await (await fetch(`${API}/configuracao`)).json()) as { semSinalSegundos: number };
      silencioMs = (config.semSinalSegundos + 25) * 1000;
      return;
    } catch {
      if (tentativa === 1) console.log(`Aguardando a API em ${API}...`);
      await new Promise((ok) => setTimeout(ok, 1000));
    }
  }
}

async function principal() {
  await aguardarApi();
  await tick();
  console.log(`Simulando ${aparelhos.size} rastreadores (ciclo de ${TICK_MS / 1000} s).`);
  if (AUTO_VENDA_MIN > 0) {
    console.log(`Vendas automáticas a cada ${AUTO_VENDA_MIN} min.`);
    setInterval(sortearVenda, AUTO_VENDA_MIN * 60_000);
  }

  let rodando = false;
  setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try {
      await tick();
    } catch (e) {
      console.warn(`Ciclo falhou: ${(e as Error).message}`);
    } finally {
      rodando = false;
    }
  }, TICK_MS);
}

principal();
