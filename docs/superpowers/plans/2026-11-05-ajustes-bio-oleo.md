# Ajustes a partir da apresentação da Bio Óleo · plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar litros na coleta, avisar quando a coleta rende bem menos que o histórico do cliente, espalhar os
clientes pelo raio real de atendimento sem deixar a demonstração lenta e trocar "caminhão" por "furgão".

**Architecture:** Tudo estende o que existe. Banco ganha versão de esquema (recria sozinho se antigo), a coluna
`movimentacoes.litros` e o tipo de alerta `COLETA_ABAIXO`. A regra nova mora num módulo próprio
(`server/src/rendimento.ts`) chamado por `coletar`. O simulador ganha um módulo de percurso com o cálculo da
velocidade por viagem.

**Tech Stack:** Node 23.6+ rodando TypeScript direto, Express, `node:sqlite`, `node:test`, React + Vite.

**Spec:** `docs/superpowers/specs/2026-11-05-ajustes-bio-oleo-design.md`

## Global Constraints

- Node 23.6+, SQLite embutido, **nenhuma dependência nova**.
- Os 32 testes atuais continuam passando (`npm test`); `npm run typecheck` sem erro.
- Litros: inteiro, de 0 até `capacidade_l` da bombona; obrigatório na coleta normal, ignorado na recuperação.
- RN18: esperado = média das últimas `COLETA_HISTORICO_N` (3) coletas normais **anteriores** do cliente; dispara
  com `litros < esperado × COLETA_MINIMO_PCT / 100` (50). Alerta `COLETA_ABAIXO`, severidade `AVISO`.
- `COLETA_ABAIXO` **não** conta no risco (RN14) e **não** muda o status da bombona.
- Furgão: passo = `max(100 m/s, comprimento da rota / 90 s)`; venda e devolução continuam a 73 m/s.
- Seed: os 14 clientes e as 24 bombonas atuais mantêm ordem e índices (os testes usam `clienteId: 6`,
  `BO-0001`, `BO-0002`, `BO-0003`, `BO-0018`–`BO-0020`). Tudo que é novo entra **depois**.
- Textos de tela em português, no tom dos que já existem.

## Review Focus

1. Litros vindos como texto (`"42"`), fracionário (`42.5`), negativo ou acima da capacidade → `400` com
   mensagem clara, sem registrar a coleta. Teste na Task 2.
2. Cliente com exatamente `N - 1` coletas, ou com recuperações no meio do histórico → recuperações não entram na
   média, e com menos de `N` coletas normais não há alerta. Teste na Task 3.
3. Coleta de 0 L (cliente fechado) dispara o aviso; histórico todo zerado (esperado 0) nunca dispara. Teste na
   Task 3.
4. Banco `bombonas.db` de uma versão anterior → a API sobe, recria o banco e o seed roda. Teste na Task 1.
5. Duas coletas baixas seguidas da mesma bombona, com o primeiro aviso ainda aberto → o primeiro é resolvido
   pelo SISTEMA e o segundo fica aberto (RN12). Teste na Task 3.

---

### Task 1: Esquema versionado, coluna de litros e tipo de alerta novo

**Files:**
- Modify: `server/src/db.ts` (ESQUEMA e `abrirBanco`)
- Modify: `server/src/alertas.ts:4` (`TipoAlerta`)
- Test: `server/test/db.test.ts` (novo)

**Interfaces:**
- Produces: `export const VERSAO_ESQUEMA = 2` em `db.ts`; `movimentacoes.litros INTEGER` (nulo permitido);
  `alertas.tipo` aceita `'COLETA_ABAIXO'`; `TipoAlerta` inclui `'COLETA_ABAIXO'`.

- [ ] **Step 1: Write the failing test** em `server/test/db.test.ts`

```ts
it('recria um banco de versão antiga e aceita o esquema novo', () => {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'esg-')), 'bombonas.db');
  const antigo = new DatabaseSync(arquivo);
  antigo.exec(`CREATE TABLE alertas (id INTEGER PRIMARY KEY, tipo TEXT CHECK (tipo IN ('FORA_DA_AREA')));
               CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT); INSERT INTO clientes (nome) VALUES ('velho');`);
  antigo.close();

  const db = abrirBanco(arquivo);
  assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, VERSAO_ESQUEMA);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM clientes').get() as any).n, 0);
  const cols = (db.prepare('PRAGMA table_info(movimentacoes)').all() as any[]).map((c) => c.name);
  assert.ok(cols.includes('litros'));
});

it('não apaga um banco que já está na versão atual', () => { /* abre, insere cliente, fecha, reabre: n = 1 */ });
```

- [ ] **Step 2: Run** `npm test -w server` → FAIL (`VERSAO_ESQUEMA` não exportado).
- [ ] **Step 3: Implement.** No ESQUEMA: `litros INTEGER` em `movimentacoes` e `'COLETA_ABAIXO'` no `CHECK` de
  `alertas.tipo`. Em `abrirBanco`: se o arquivo não for `:memory:`, existir, tiver tabelas e `user_version <
  VERSAO_ESQUEMA`, fechar, apagar o arquivo e os `-wal`/`-shm` e reabrir; depois do `exec(ESQUEMA)`, gravar
  `PRAGMA user_version = 2`. A migração da coluna `reaberto` pode sair (fica coberta pela recriação). Adicionar
  `'COLETA_ABAIXO'` a `TipoAlerta`.
- [ ] **Step 4: Run** `npm test -w server` → todos passam.
- [ ] **Step 5: Commit** `feat(server): esquema versionado com litros e alerta COLETA_ABAIXO`

### Task 2: Litros na coleta (RN17)

**Files:**
- Modify: `server/src/operacoes.ts` (`registrarMovimentacao`, `coletar`)
- Modify: `server/src/rotas/operacao.ts` (rota `/bombonas/:codigo/coleta`)
- Modify: `server/src/consultas.ts:118-123` (movimentações do detalhe incluem `litros`)
- Test: `server/test/operacao.test.ts` (atualizar as coletas existentes das linhas 43 e 72; testes novos)

**Interfaces:**
- Consumes: coluna `movimentacoes.litros` (Task 1).
- Produces: `coletar(ctx: Contexto, codigo: string, entrada: { litros?: unknown; observacao?: string } = {})`;
  `registrarMovimentacao(ctx, bombonaId, tipo, clienteId, observacao?, litros?: number | null)`; cada item de
  `detalhe.movimentacoes` tem `litros: number | null`.

- [ ] **Step 1: Write the failing tests**

```ts
it('coleta normal exige litros inteiros entre 0 e a capacidade (RN17)', async () => {
  for (const litros of [undefined, '42', 42.5, -1, 51]) // BO-0001 é de 50 L
    assert.equal((await post('/bombonas/BO-0001/coleta', { litros })).status, 400);
  assert.equal((await get('/bombonas/BO-0001')).status, 'EM_CLIENTE'); // nada foi registrado
});

it('guarda os litros na movimentação de coleta', async () => {
  await post('/bombonas/BO-0004/coleta', { litros: 38 });
  const [mov] = (await get('/bombonas/BO-0004')).movimentacoes;
  assert.deepEqual([mov.tipo, mov.litros], ['COLETA', 38]);
});

```

Estender o teste de recuperação (linha 55, `BO-0003`): a coleta sem litros continua `200` e
`detalhe.movimentacoes[0].litros === null`.

Atualizar a coleta de `BO-0002` (linha 43) para mandar `{ litros: 40, observacao: 'Coleta semanal' }`.

- [ ] **Step 2: Run** `npm test -w server` → FAIL.
- [ ] **Step 3: Implement.** A rota passa `req.body?.litros` e `req.body?.observacao` sem converter. Em `coletar`,
  na coleta normal, validar com `Number.isInteger(litros) && litros >= 0 && litros <= b.capacidade_l`; senão
  `ErroDeNegocio(400, 'Informe os litros coletados: número inteiro de 0 a <capacidade> L')`. Na recuperação, gravar
  `null`. A validação vem antes da transação.
- [ ] **Step 4: Run** `npm test -w server` → todos passam.
- [ ] **Step 5: Commit** `feat(server): coleta registra litros (RN17)`

### Task 3: Coleta abaixo do esperado (RN18)

**Files:**
- Create: `server/src/rendimento.ts`
- Modify: `server/src/config.ts` (`coletaHistoricoN`, `coletaMinimoPct`)
- Modify: `server/src/operacoes.ts` (`coletar` chama a regra e publica os alertas)
- Test: `server/test/rendimento.test.ts` (novo)

**Interfaces:**
- Consumes: `coletar` e `litros` (Task 2); `abrirAlerta`, `resolverAlertasDaBombona` (`alertas.ts`).
- Produces:
  - `Config.coletaHistoricoN: number` (env `COLETA_HISTORICO_N`, padrão 3) e `Config.coletaMinimoPct: number`
    (env `COLETA_MINIMO_PCT`, padrão 50).
  - `litrosEsperados(db: Banco, clienteId: number, n: number): number | null`: média dos `litros` das últimas
    `n` movimentações `COLETA` do cliente com `litros` não nulo (ordem `criado_em DESC, id DESC`); `null` com
    menos de `n`.
  - `avaliarColeta(db: Banco, config: Config, c: { bombonaId: number; clienteId: number; litros: number; esperado: number | null; em: string }): Alerta[]`:
    devolve os alertas tocados (o antigo resolvido, se houver, e o novo). `Alerta` = `NonNullable<ReturnType<typeof alertaPorId>>`.

- [ ] **Step 1: Write the failing tests.** Use um cliente do seed e insira o histórico direto no banco, com
  `criado_em` mais recente que qualquer dado do seed (ex.: `new Date(Date.now() - k * 60_000).toISOString()`),
  para que as últimas N sejam sempre as inseridas.

```ts
it('calcula a média das últimas N coletas normais e ignora recuperações', () => {
  historico(1, [40, 50, 60]); recuperacao(1, 5);
  assert.equal(litrosEsperados(ctx.db, 1, 3), 50);
  assert.equal(litrosEsperados(ctx.db, 99, 3), null);
});

it('abre COLETA_ABAIXO (AVISO) abaixo de 50% e não conta no risco', async () => {
  historico(6, [50, 50, 50]);                       // BO-0009 está no cliente 6
  const riscoAntes = await risco(6);
  await post('/bombonas/BO-0009/coleta', { litros: 20 });
  const a = alertaAberto('BO-0009', 'COLETA_ABAIXO');
  assert.equal(a.severidade, 'AVISO');
  assert.match(a.mensagem, /20 L.*50 L/);
  assert.deepEqual(await risco(6), riscoAntes);
});

it('não dispara com 50% ou mais, com menos de N coletas ou com esperado 0', ...);
it('coleta de 0 L dispara o aviso', ...);
it('segunda coleta baixa resolve o aviso aberto (SISTEMA) e abre outro (RN12)', ...);
```

- [ ] **Step 2: Run** `npm test -w server` → FAIL.
- [ ] **Step 3: Implement.** Em `coletar` (coleta normal), calcular `esperado` **antes** de inserir a movimentação
  e chamar `avaliarColeta` dentro da mesma transação; somar o retorno aos alertas publicados. Em `avaliarColeta`,
  quando `esperado` for nulo ou `litros >= esperado * pct / 100`, não fazer nada. Senão, resolver um
  `COLETA_ABAIXO` aberto da bombona (`por: 'SISTEMA'`, texto `'Substituído por uma coleta mais recente'`) e abrir
  o novo com `clienteId` e a mensagem
  `` `Coleta de ${litros} L, esperado ~${Math.round(esperado)} L (média das últimas ${n} coletas)` ``.
- [ ] **Step 4: Run** `npm test -w server` → todos passam.
- [ ] **Step 5: Commit** `feat(server): aviso de coleta abaixo do esperado (RN18)`

### Task 4: Painel — campo de litros e rótulos

**Files:**
- Modify: `web/src/api.ts` (`TipoAlerta`, `Movimentacao`, `api.coletar`)
- Modify: `web/src/formato.ts` (`rotuloAlerta`)
- Modify: `web/src/paginas/AcoesBombona.tsx` (formulário de coleta)
- Modify: `web/src/paginas/PainelBombona.tsx:57` (linha do tempo)

**Interfaces:**
- Consumes: API das Tasks 2 e 3.
- Produces: `api.coletar(codigo: string, entrada: { litros?: number; observacao?: string })`;
  `Movimentacao.litros: number | null`; `rotuloAlerta.COLETA_ABAIXO = 'Coleta abaixo do esperado'`.

- [ ] **Step 1: Implement.** Na coleta normal, um `<input type="number" min={0} max={b.capacidadeL} step={1} required>`
  rotulado "Litros coletados" antes da observação; ele não aparece na recuperação e é limpo depois do envio. Na
  linha do tempo, o título da movimentação recebe `` ` · ${m.litros} L` `` quando `litros` não for nulo.
- [ ] **Step 2: Run** `npm run typecheck` → sem erro.
- [ ] **Step 3: Verificar no navegador** (`npm run dev`, http://localhost:5173): coletar uma bombona com 1 L num
  cliente que tenha histórico → aviso ao vivo "Coleta abaixo do esperado", alerta na tela Alertas, litros na linha
  do tempo; recuperação sem o campo.
- [ ] **Step 4: Commit** `feat(web): litros na coleta e aviso de coleta abaixo do esperado`

### Task 5: Seed na escala real, com histórico de litros

**Files:**
- Modify: `server/src/seed.ts`
- Test: `server/test/consultas.test.ts` (testes novos)

**Interfaces:**
- Consumes: `movimentacoes.litros` (Task 1).
- Produces: 25 clientes em 15 cidades; cada cliente com de 3 a 6 movimentações `COLETA` antigas com litros.

- [ ] **Step 1: Write the failing tests**

```ts
it('espalha os clientes pelo raio de atendimento', () => {
  const clientes = ctx.db.prepare('SELECT cidade, lat, lng FROM clientes').all() as any[];
  assert.ok(clientes.length >= 25);
  assert.ok(new Set(clientes.map((c) => c.cidade)).size >= 12);
  for (const c of clientes) assert.ok(distanciaM(ctx.config.patio, c) <= 250_000);
  assert.ok(clientes.some((c) => distanciaM(ctx.config.patio, c) >= 100_000));
});

it('cada cliente tem pelo menos 3 coletas com litros dentro da capacidade', () => { /* JOIN bombonas */ });
```

(`distanciaM` vem de `server/src/geo.ts`; use a função de distância que já existe lá.)

- [ ] **Step 2: Run** `npm test -w server` → FAIL.
- [ ] **Step 3: Implement.** Manter `CLIENTES[0..13]`, `ALOCACOES`, `NO_PATIO` e `EM_ROTA_PARA` como estão.
  Acrescentar 11 clientes em `CLIENTES` e uma lista `ALOCACOES_REGIAO` (uma bombona por cliente novo),
  adicionada **no fim** de `plano`. Cidades novas, com coordenadas aproximadas do centro: Umuarama
  (-23.766, -53.325), Maringá (-23.420, -51.933; 2 clientes), Campo Mourão (-24.046, -52.383), Paranavaí
  (-23.073, -52.465), Cruzeiro do Oeste (-23.785, -53.073), Goioerê (-24.185, -53.025), Cidade Gaúcha
  (-23.378, -52.944), Rondon (-23.411, -52.765), Cascavel (-24.955, -53.455; 2 clientes). Nomes e endereços
  inventados, no estilo dos atuais. Histórico: para o cliente k, `3 + (k % 4)` coletas a cada 7 dias, começando
  15 dias atrás, na bombona alocada ao cliente, com litros em torno de uma média do cliente (55% a 85% da
  capacidade) variando ±15% (`rnd`). Nenhuma passa da capacidade nem fica abaixo de 50% da média.
- [ ] **Step 4: Run** `npm test -w server` → todos passam (os testes antigos provam que os índices não mudaram).
- [ ] **Step 5: Commit** `feat(server): seed no raio real de atendimento com histórico de litros`

### Task 6: Velocidade do furgão proporcional à distância

**Files:**
- Create: `simulator/src/percurso.ts`
- Modify: `simulator/src/index.ts` (geometria passa a ser importada; `rota` guarda o passo da viagem)
- Modify: `simulator/package.json` (script `test`) e `package.json` da raiz (`"test": "npm test -w server -w simulator"`)
- Test: `simulator/test/percurso.test.ts` (novo)

**Interfaces:**
- Produces: em `percurso.ts`: `type Ponto = { lat: number; lng: number }`, `distanciaM(a: Ponto, b: Ponto): number`
  (movida de `index.ts`), `comprimentoM(pontos: Ponto[]): number` e
  `passoDaViagem(comprimentoM: number, passoBaseM: number, ticksMax: number): number`
  = `Math.max(passoBaseM, comprimentoM / ticksMax)`.

- [ ] **Step 1: Write the failing test** (com `TICK_MS = 250`: base 25 m por tick e 360 ticks em 90 s)

```ts
assert.equal(passoDaViagem(1_000, 25, 360), 25);    // curta: velocidade de sempre
assert.equal(passoDaViagem(9_000, 25, 360), 25);    // limite: 90 s a 100 m/s
assert.equal(passoDaViagem(90_000, 25, 360), 250);  // longa: termina em 90 s
assert.equal(Math.round(comprimentoM([{ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 }, { lat: 0.02, lng: 0 }])), 2224);
```

- [ ] **Step 2: Run** `npm test -w simulator` → FAIL.
- [ ] **Step 3: Implement.** `const DURACAO_MAX_VIAGEM_S = 90`. `Aparelho.rota` ganha `passo: number`. Em
  `planejarViagem`, para viagens do furgão, guardar `passoDaViagem(comprimentoM([ap.posicao, ...pontos]), viagem.passo, DURACAO_MAX_VIAGEM_S * 1000 / TICK_MS)`;
  para as outras, `viagem.passo`. Em `mover`, usar `rota.passo`. Registrar no log a velocidade em m/s quando
  passar da base.
- [ ] **Step 4: Run** `npm test` (raiz) → server e simulator passam; `npm run typecheck` → sem erro.
- [ ] **Step 5: Verificar com o OSRM real:** `npm run dev`, mandar uma bombona do pátio para o cliente de
  Cascavel → chega em ~90 s, e a previsão de chegada no painel fica coerente durante a viagem.
- [ ] **Step 6: Commit** `feat(simulator): viagem do furgão com teto de 90 s`

### Task 7: Furgão no lugar de caminhão, e textos com os dados reais

**Files:**
- Modify: todos os arquivos com `caminhão`/`caminhao` em `server/`, `simulator/`, `web/src/`, `README.md`,
  `simulator/README.md`, `docs/regras-de-negocio.md`, `docs/contrato-dispositivo.md` (localizar com o grep do Step 2)
- Modify: `README.md` ("Limitações assumidas", "Roteiro de demonstração") e `docs/regras-de-negocio.md`
  (aviso do topo, "Contexto assumido", RN17, RN18, tabela de parâmetros)

**Interfaces:**
- Consumes: nomes das Tasks 2, 3 e 6 (`COLETA_HISTORICO_N`, `COLETA_MINIMO_PCT`, `DURACAO_MAX_VIAGEM_S`).

- [ ] **Step 1: Implement.** Trocar por "furgão"/"furgao" em textos, logs, comentários e identificadores (ex.:
  `PASSO_CAMINHAO_M` → `PASSO_FURGAO_M`, chave de viagem `caminhao:` → `furgao:`). Nos docs, citar a fonte como
  "apresentação da Bio Óleo em aula (Aula 07)", com os números do spec (1.453 pontos, mais de 70 municípios,
  250 km, furgões rastreados, pagamento por litros, lacre com trava). Manter que o sumiço por venda clandestina é
  o problema trabalhado e que os parâmetros continuam hipóteses a validar. Escrever RN17 e RN18 conforme as
  Tasks 2 e 3, acrescentar os dois parâmetros na tabela e, no roteiro de demonstração, um passo: "registre uma
  coleta com poucos litros num cliente com histórico e veja o aviso".
- [ ] **Step 2: Verify** `grep -rniE "caminh(ã|a)o" --exclude-dir=node_modules --exclude-dir=superpowers server simulator web/src docs README.md` → nenhuma saída.
- [ ] **Step 3: Run** `npm test` e `npm run typecheck` → passam.
- [ ] **Step 4: Commit** `docs: furgão e dados reais da Bio Óleo; RN17 e RN18`
