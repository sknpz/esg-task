/**
 * Simulador dos rastreadores das bombonas.
 *
 * Faz o papel do hardware que ainda não existe: cada bombona "envia" a própria posição pelo
 * contrato público (POST /api/telemetria, com o token do dispositivo), como um aparelho real faria.
 *
 * Para saber onde cada bombona deveria estar e quais cenários o painel pediu, ele consulta o canal
 * de controle da demonstração (GET /api/simulacao/estado). Esse canal não existe num cenário real.
 *
 * Também dirige os furgões dos roteiros do dia (furgoes.ts): as bombonas dentro de um furgão vão junto com ele.
 */

import { consultarOsrm, criarFrota, type RoteiroRemoto } from './furgoes.ts';
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
  /** Furgão (roteiro) em que a bombona está; null fora de furgão. */
  roteiroId: number | null;
  clienteId: number | null;
  /** Vendida com o rastreador arrancado (servidor guarda o cenário): vale ao recriar o aparelho num reinício. */
  arrancada: boolean;
};
type Comando = { id: number; bombona: string; tipo: 'VENDA' | 'DEVOLUCAO' | 'SEM_SINAL' | 'BATERIA_FRACA' | 'VENDA_SILENCIOSA' };
type Estado = {
  operacao: { data: string; pausado: boolean };
  roteiros: RoteiroRemoto[];
  dispositivos: DispositivoRemoto[];
  comandos: Comando[];
};

type Aparelho = {
  remoto: DispositivoRemoto;
  posicao: Ponto;
  bateria: number;
  /** Alguém "comprou" a bombona e está levando embora. */
  desvio?: boolean;
  /** A bombona está sendo devolvida ao local esperado. */
  devolvendo?: boolean;
  /** Vendida com o rastreador arrancado: não manda mais leitura e o furgão não a acha no cliente. */
  arrancada?: boolean;
  caladoAte?: number;
  ticksParado: number;
  /** Caminho pelas ruas da viagem atual (pontos que ainda faltam). */
  rota?: { chave: string; pontos: Ponto[]; passo: number };
  /** Busca de rota em andamento ou aguardando nova tentativa. */
  planejando?: { chave: string; ocupado: boolean; proximaEm: number };
};

/** Um deslocamento pelas ruas de uma bombona sozinha: recuperação (furgão), comprador ou devolução. */
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
/** Número do ambiente; 0 vale (desliga), ausente ou inválido usa o padrão. */
function numeroDoAmbiente(nome: string, padrao: number) {
  const texto = process.env[nome];
  const valor = Number(texto);
  return texto !== undefined && texto.trim() !== '' && Number.isFinite(valor) ? valor : padrao;
}
/** Duração alvo de um roteiro inteiro (pátio → paradas → pátio), pausas incluídas. */
const DURACAO_ROTEIRO_S = numeroDoAmbiente('SIM_DURACAO_ROTEIRO_S', 90);
/** Pausa do furgão em cada parada, para a troca ficar visível. */
const PAUSA_PARADA_MS = numeroDoAmbiente('SIM_PAUSA_PARADA_MS', 1000);
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
/**
 * Chance de uma venda clandestina sorteada a cada dia simulado (no total, não por bombona). Na vida real elas são
 * frequentes; a demonstração as deixa raras para não poluir a tela.
 */
const VENDAS_POR_DIA = numeroDoAmbiente('SIM_VENDAS_POR_DIA', 0.4);

const aparelhos = new Map<string, Aparelho>();
let silencioMs = 70_000;
/** Último estado dos dispositivos vindo do servidor (na ordem dos códigos). */
let dispositivos: DispositivoRemoto[] = [];
/** Data de operação vista no ciclo anterior: a venda do dia é sorteada quando ela muda. */
let dataVista: string | undefined;
let frota: ReturnType<typeof criarFrota>;

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
  return (await r.json()) as Estado;
}

const consultarRota = (de: Ponto, para: Ponto) => consultarOsrm(ROTEADOR, [de, para]);

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
  const { status, alvo, roteiroId } = ap.remoto;
  // No furgão de um roteiro: não tem viagem própria, vai aonde o furgão for.
  if (roteiroId !== null || ap.arrancada) return null;
  // Em rota sem roteiro: extraviada recuperada, levada ao pátio sozinha.
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
    case 'VENDA_SILENCIOSA':
      ap.arrancada = true;
      ap.desvio = false;
      ap.devolvendo = false;
      ap.rota = undefined;
      console.log(`[${c.bombona}] cenário VENDA COM RASTREADOR ARRANCADO: a bombona sumiu e o rastreador parou de mandar leituras`);
      break;
  }
}

/** Venda do dia: uma bombona qualquer parada em cliente, fora de furgão. */
function sortearVenda() {
  const candidatas = [...aparelhos.values()].filter(
    (a) => a.remoto.status === 'EM_CLIENTE' && a.remoto.roteiroId === null && !a.desvio && !a.devolvendo && !a.arrancada,
  );
  const escolhida = candidatas[Math.floor(Math.random() * candidatas.length)];
  if (escolhida) aplicarComando({ id: 0, bombona: escolhida.remoto.bombona, tipo: 'VENDA' });
}

/** O dia simulado mudou: com chance VENDAS_POR_DIA, uma venda clandestina. Pausado, não há sorteio. */
function vendasDoDia(data: string, pausado: boolean) {
  const virou = dataVista !== undefined && data !== dataVista;
  dataVista = data;
  if (virou && !pausado && Math.random() < VENDAS_POR_DIA) sortearVenda();
}

/**
 * O que o furgão encontra no cliente. `procuradas`: as do cliente fora de furgão, paradas lá ou extraviadas (na ordem
 * do servidor). `achadas`: as que estão lá de fato, isto é, em cliente no servidor e não vendidas (com ou sem o
 * rastreador).
 */
function noCliente(clienteId: number) {
  const doCliente = dispositivos.filter(
    (d) => d.clienteId === clienteId && d.roteiroId === null && (d.status === 'EM_CLIENTE' || d.status === 'EXTRAVIADA'),
  );
  const achadas = doCliente.filter((d) => {
    const ap = aparelhos.get(d.dispositivoId);
    return d.status === 'EM_CLIENTE' && !ap?.desvio && !ap?.arrancada;
  });
  return { procuradas: doCliente.map((d) => d.bombona), achadas: achadas.map((d) => d.bombona) };
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
        // Simulador reiniciado: a venda com rastreador arrancado continua valendo (senão a bombona "voltaria").
        arrancada: remoto.arrancada,
        ticksParado: Math.floor(Math.random() * TICKS_ENTRE_SINAIS_PARADA),
      });
      continue;
    }
    // Coletada pelo furgão (ou recuperada): quem estava com a bombona perdeu ela; a recuperada ganha rastreador novo.
    if (remoto.status === 'EM_ROTA' && ap.remoto.status !== 'EM_ROTA') {
      ap.desvio = false;
      ap.devolvendo = false;
      ap.arrancada = false;
    }
    // Saiu do furgão (deixada no cliente ou descarregada no pátio): fica no lugar esperado, fora da rua.
    if (ap.remoto.roteiroId !== null && remoto.roteiroId === null && remoto.alvo) {
      ap.posicao = { lat: remoto.alvo.lat, lng: remoto.alvo.lng };
      ap.rota = undefined;
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
  const estado = await buscarEstado();
  const { operacao, roteiros, comandos } = estado;
  dispositivos = estado.dispositivos;
  sincronizar(dispositivos);
  comandos.forEach(aplicarComando);
  vendasDoDia(operacao.data, operacao.pausado);

  // Pausado: ninguém se move (furgão, venda, devolução); os parados continuam mandando a última posição.
  const envios = frota.ciclo(roteiros, operacao.pausado);
  for (const ap of aparelhos.values()) {
    // Rastreador arrancado: nunca mais manda leitura.
    if (ap.arrancada) continue;
    const viagem = viagemAtual(ap);
    if (viagem) void planejarViagem(ap, viagem);
    else ap.planejando = undefined;

    // Rastreador calado: a bombona continua andando (uma venda com o sinal cortado leva ela embora de verdade); só
    // a leitura não sai.
    const calado = ap.caladoAte !== undefined && ap.caladoAte > Date.now();
    if (ap.caladoAte && !calado) {
      ap.caladoAte = undefined;
      console.log(`[${ap.remoto.bombona}] sinal de volta`);
    }

    let emMovimento = false;
    if (ap.remoto.roteiroId !== null) {
      // No furgão: a posição é a dele.
      const furgao = frota.posicao(ap.remoto.roteiroId);
      if (furgao) {
        ap.posicao = furgao.posicao;
        emMovimento = furgao.emMovimento;
      }
    } else if (!operacao.pausado) {
      emMovimento = mover(ap, viagem);
    }
    ap.bateria = Math.max(0, ap.bateria - (emMovimento ? CONSUMO_MOVIMENTO : CONSUMO_PARADA));
    // A leitura repetida logo ao parar marca o fim do percurso, mesmo que a bombona saia de novo em menos de 1 s.
    const acabouDeParar = !emMovimento && ap.ticksParado === 0;
    ap.ticksParado = emMovimento ? 0 : ap.ticksParado + 1;
    if (calado) continue;
    if (emMovimento || acabouDeParar || ap.ticksParado % TICKS_ENTRE_SINAIS_PARADA === 0) {
      envios.push(enviarLeitura(ap, emMovimento).catch((e) => console.warn(`[${ap.remoto.bombona}] falha no envio: ${e.message}`)));
    }
  }
  await Promise.all(envios);
}

async function aguardarApi() {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const config = (await (await fetch(`${API}/configuracao`)).json()) as { semSinalSegundos: number; patio: Ponto };
      silencioMs = (config.semSinalSegundos + 25) * 1000;
      frota = criarFrota({
        api: API,
        token: TOKEN_SIMULADOR,
        roteador: ROTEADOR,
        patio: { lat: config.patio.lat, lng: config.patio.lng },
        tempo: { duracaoS: DURACAO_ROTEIRO_S, pausaMs: PAUSA_PARADA_MS, tickMs: TICK_MS },
        passoBaseM: PASSO_FURGAO_M,
        esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS,
        noCliente,
      });
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
  console.log(`Furgões: roteiro em ~${DURACAO_ROTEIRO_S} s, ${PAUSA_PARADA_MS} ms por parada. Vendas sorteadas: ${VENDAS_POR_DIA} por dia.`);

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
