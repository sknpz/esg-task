import { criarApp } from './app.ts';
import { carregarConfig } from './config.ts';
import { abrirBanco } from './db.ts';
import { criarHubDeEventos } from './eventos.ts';
import { verificarSemSinal } from './regras.ts';
import { popularSeVazio } from './seed.ts';

const config = carregarConfig();
const db = abrirBanco(config.caminhoBanco);
if (popularSeVazio(db, config)) console.log('Banco criado com dados fictícios.');

const ctx = { db, config, eventos: criarHubDeEventos() };
const app = criarApp(ctx);

// RN10: varredura de dispositivos sem sinal.
const intervaloVarredura = Math.max(1000, Math.min(config.semSinalSegundos * 1000, 60_000) / 3);
setInterval(() => verificarSemSinal(ctx), intervaloVarredura).unref();

app.listen(config.porta, () => {
  console.log(`API do rastreio de bombonas em http://localhost:${config.porta}/api`);
  console.log(`Sem sinal após ${config.semSinalSegundos}s · extravio após ${config.extravioMetros} m`);
});
