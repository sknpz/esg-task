import { criarApp } from './app.ts';
import { carregarConfig } from './config.ts';
import { abrirBanco } from './db.ts';
import { popularSeVazio } from './seed.ts';

const config = carregarConfig();
const db = abrirBanco(config.caminhoBanco);
if (popularSeVazio(db, config)) console.log('Banco criado com dados fictícios.');

const app = criarApp({ db, config });
app.listen(config.porta, () => {
  console.log(`API do rastreio de bombonas em http://localhost:${config.porta}/api`);
});
