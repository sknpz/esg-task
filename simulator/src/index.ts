/**
 * Simulador dos rastreadores das bombonas.
 *
 * Faz o papel do hardware que ainda não existe: cada bombona "envia" a própria posição pelo
 * contrato público (POST /api/telemetria, com o token do dispositivo), como um aparelho real faria.
 *
 * Para saber onde cada bombona deveria estar e quais cenários o painel pediu, ele consulta o canal
 * de controle da demonstração (GET /api/simulacao/estado). Esse canal não existe num cenário real.
 */

type Ponto = { lat: number; lng: number };
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
  /** Para onde quem "comprou" a bombona está levando. */
  desvio?: Ponto;
  /** A bombona está sendo devolvida ao local esperado. */
  devolvendo?: boolean;
  caladoAte?: number;
  ticksParado: number;
};

const API = process.env.API_URL ?? 'http://localhost:3333/api';
const TOKEN_SIMULADOR = process.env.SIM_TOKEN ?? 'sim-demo-token';
const TICK_MS = Number(process.env.SIM_TICK_MS) || 3000;
/** Bombona parada manda sinal a cada N ticks; em movimento, a cada tick. */
const TICKS_ENTRE_SINAIS_PARADA = 5;
/** Quanto anda por tick (tempo da demonstração é acelerado). */
const PASSO_CAMINHAO_M = 300;
const PASSO_VENDA_M = 220;
/** Minutos entre "vendas" automáticas de bombonas aleatórias (0 desliga). */
const AUTO_VENDA_MIN = Number(process.env.SIM_AUTO_VENDA_MIN) || 0;

const aparelhos = new Map<string, Aparelho>();
let silencioMs = 70_000;

// ---------- geometria ----------

const M_POR_GRAU_LAT = 111_195;
const mPorGrauLng = (lat: number) => M_POR_GRAU_LAT * Math.cos((lat * Math.PI) / 180);

function distanciaM(a: Ponto, b: Ponto) {
  const dy = (b.lat - a.lat) * M_POR_GRAU_LAT;
  const dx = (b.lng - a.lng) * mPorGrauLng(a.lat);
  return Math.hypot(dx, dy);
}

function deslocar(p: Ponto, norteM: number, lesteM: number): Ponto {
  return { lat: p.lat + norteM / M_POR_GRAU_LAT, lng: p.lng + lesteM / mPorGrauLng(p.lat) };
}

/** Anda `passo` metros em direção ao alvo, com uma leve curva para parecer rua. Devolve true ao chegar. */
function andar(ap: Aparelho, alvo: Ponto, passo: number) {
  const falta = distanciaM(ap.posicao, alvo);
  if (falta <= passo) {
    ap.posicao = alvo;
    return true;
  }
  const f = passo / falta;
  const norte = (alvo.lat - ap.posicao.lat) * M_POR_GRAU_LAT * f;
  const leste = (alvo.lng - ap.posicao.lng) * mPorGrauLng(ap.posicao.lat) * f;
  const curva = (Math.random() - 0.5) * 0.5;
  ap.posicao = deslocar(ap.posicao, norte - leste * curva, leste + norte * curva);
  return false;
}

const ruidoGps = (p: Ponto, metros: number) => deslocar(p, (Math.random() - 0.5) * 2 * metros, (Math.random() - 0.5) * 2 * metros);

const ROSA = ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste'];

// ---------- comunicação ----------

async function buscarEstado() {
  const r = await fetch(`${API}/simulacao/estado`, { headers: { Authorization: `Bearer ${TOKEN_SIMULADOR}` } });
  if (!r.ok) throw new Error(`estado: HTTP ${r.status}`);
  return (await r.json()) as { dispositivos: DispositivoRemoto[]; comandos: Comando[] };
}

/** Exatamente o que um rastreador real enviaria (docs/contrato-dispositivo.md). */
async function enviarLeitura(ap: Aparelho, emMovimento: boolean) {
  const precisao = emMovimento ? 15 : 6 + Math.random() * 6;
  const { lat, lng } = ruidoGps(ap.posicao, precisao / 2);
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
    case 'VENDA': {
      const angulo = Math.random() * 2 * Math.PI;
      const distancia = 4000 + Math.random() * 5000;
      ap.desvio = deslocar(ap.posicao, Math.cos(angulo) * distancia, Math.sin(angulo) * distancia);
      ap.devolvendo = false;
      const rumo = ROSA[Math.round(((angulo * 180) / Math.PI / 45)) % 8];
      console.log(`[${c.bombona}] cenário VENDA: alguém está levando a bombona ${(distancia / 1000).toFixed(1)} km a ${rumo}`);
      break;
    }
    case 'DEVOLUCAO':
      ap.desvio = undefined;
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
    // Coletada pelo caminhão: quem estava com a bombona perdeu ela.
    if (remoto.status === 'EM_ROTA' && ap.remoto.status !== 'EM_ROTA') {
      ap.desvio = undefined;
      ap.devolvendo = false;
    }
    ap.remoto = remoto;
  }
}

async function tick() {
  const { dispositivos, comandos } = await buscarEstado();
  sincronizar(dispositivos);
  comandos.forEach(aplicarComando);

  const envios: Promise<void>[] = [];
  for (const ap of aparelhos.values()) {
    if (ap.caladoAte && ap.caladoAte > Date.now()) continue;
    if (ap.caladoAte) {
      ap.caladoAte = undefined;
      console.log(`[${ap.remoto.bombona}] sinal de volta`);
    }

    let emMovimento = false;
    if (ap.desvio && ap.remoto.status !== 'EM_ROTA') {
      emMovimento = !andar(ap, ap.desvio, PASSO_VENDA_M);
    } else if (ap.devolvendo && ap.remoto.alvo) {
      ap.devolvendo = !andar(ap, ap.remoto.alvo, PASSO_VENDA_M);
      emMovimento = true;
    } else if (ap.remoto.status === 'EM_ROTA' && ap.remoto.alvo) {
      andar(ap, ap.remoto.alvo, PASSO_CAMINHAO_M);
      emMovimento = true;
    }

    ap.bateria = Math.max(0, ap.bateria - (emMovimento ? 0.05 : 0.01));
    ap.ticksParado = emMovimento ? 0 : ap.ticksParado + 1;
    if (emMovimento || ap.ticksParado % TICKS_ENTRE_SINAIS_PARADA === 0) {
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
