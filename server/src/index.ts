import { criarApp } from './app.ts';
import { carregarConfig } from './config.ts';
import { abrirBanco } from './db.ts';
import { criarHubDeEventos } from './eventos.ts';
import { avancarOperacao, retomarAposReinicio } from './operacao.ts';
import { verificarSemSinal } from './regras.ts';
import { popularSeVazio } from './seed.ts';

const config = carregarConfig();
const db = abrirBanco(config.caminhoBanco);
if (popularSeVazio(db, config)) console.log('Banco criado com dados fictícios.');

const ctx = { db, config, eventos: criarHubDeEventos() };
const app = criarApp(ctx);

// Furgão que estava na rua quando o servidor caiu: conclui o roteiro na hora, sem animação.
try {
  retomarAposReinicio(ctx);
} catch (erro) {
  console.error('Falha ao concluir os roteiros interrompidos:', erro);
}

// RN10: varredura de dispositivos sem sinal. Calculada sobre metade do prazo, para o 2x não atrasar a detecção.
const intervaloVarredura = Math.max(1000, Math.min((config.semSinalSegundos / 2) * 1000, 60_000) / 3);
setInterval(() => verificarSemSinal(ctx), intervaloVarredura).unref();

// Relógio da operação simulada (manhã → rotas → fim do dia).
setInterval(() => {
  try {
    avancarOperacao(ctx);
  } catch (erro) {
    console.error('Falha ao avançar a operação:', erro);
  }
}, 1000).unref();

app.listen(config.porta, () => {
  console.log(`API do rastreio de bombonas em http://localhost:${config.porta}/api`);
  console.log(`Sem sinal após ${config.semSinalSegundos}s · extravio após ${config.extravioMetros} m`);
});
