# Ajustes do operador · plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pesquisa e filtros em Clientes, furgões a 80 km/h reais com modo demonstração, contrato que puxa o dia do
Início, contrato com cliente novo marcado no mapa, e acompanhar um furgão em Coletas.

**Architecture:** O servidor guarda o modo (`REAL`/`DEMO`) na `operacao`, como a velocidade 1x/2x; o simulador lê o
modo pelo `GET /simulacao/estado` e escolhe o passo do furgão e o gasto de bateria. `POST /contratos` aceita um
`novoCliente` e grava cliente + contrato numa transação. Filtros, preenchimento do dia e acompanhamento ficam no
painel, com a lógica em módulos puros testados com `node --test`.

**Tech Stack:** Node 23.6+ (TypeScript direto, `node:sqlite`, `node:test`), Express, React + react-leaflet.

**Spec:** `docs/superpowers/specs/2026-11-11-ajustes-operador-design.md`

## Global Constraints

- Node 23.6+; testes com `node --test` (`npm test` na raiz roda server, simulator e web); `npm run typecheck` na raiz.
- `VERSAO_ESQUEMA` sobe de 4 para **5** (banco antigo é descartado e recriado; sem migração).
- Modo: `'REAL' | 'DEMO'`, padrão e valor do reset **`'REAL'`**.
- Velocidade real: **80 km/h**, configurável por `SIM_VELOCIDADE_REAL_KMH`.
- Bateria em `REAL`: gasto de hoje dividido por **60**; 2x dobra nos dois modos.
- Cliente novo: raio da cerca padrão da tabela (**150 m**), ponto a **no máximo 250 km do pátio**, nome até **120**
  caracteres, sem checagem de nome repetido.
- Contrato: domingo no Início vira **segunda (1)**; dias da semana válidos 1..6.
- Acompanhar: zoom **15**.
- Textos de tela e mensagens de erro em português, no tom das telas atuais.
- Documentação (README, `simulator/README.md`, `docs/regras-de-negocio.md`) atualizada na tarefa que muda o
  comportamento descrito.

## Review Focus

1. Trocar o modo enquanto o furgão ainda está planejando a rota (sem resposta do OSRM): nada quebra e ele sai no ritmo
   do modo atual. → teste na Task 2.
2. Pesquisa com espaços nas pontas e acento/maiúscula diferentes (`"  sao PAULO "` acha "São Paulo"). → Task 4.
3. Campo Início vazio enquanto o operador digita a data: os dias já marcados não são apagados. → Task 5.
4. Cliente novo com nome só de espaços ou `lat` não numérico: 400 e nenhum cliente gravado. → Task 6.
5. Furgão acompanhado conclui o roteiro, ou o roteiro some (reset/troca de dia): o acompanhamento desliga sozinho. → Task 8.

---

### Task 1: Servidor · modo da operação (REAL/DEMO)

**Files:**
- Modify: `server/src/db.ts` (tabela `operacao`, `VERSAO_ESQUEMA`)
- Modify: `server/src/operacao.ts` (tipo, `LinhaOperacao`, `lerLinha`, `paraEstado`, `criarOperacao`, nova `definirModo`)
- Modify: `server/src/rotas/roteiros.ts` (rota `POST /operacao/modo`)
- Modify: `server/src/rotas/simulacao.ts:112-120` (`modo` no estado)
- Test: `server/test/operacao.test.ts`, ajustar `server/test/troca.test.ts:633`, `server/test/contratos.test.ts` (rótulo do teste de versão), `server/test/reset.test.ts`

**Interfaces:**
- Produces: `export type Modo = 'REAL' | 'DEMO'` (operacao.ts); `EstadoOperacao.modo: Modo`;
  `definirModo(ctx: Contexto, modo: Modo): EstadoOperacao`; `POST /api/operacao/modo` body `{ modo }` → `EstadoOperacao`,
  400 `{ erro: 'modo deve ser REAL ou DEMO' }`; `GET /api/simulacao/estado` → `operacao: { data, pausado, velocidade, modo, rodada }`.

- [ ] **Step 1: Testes que falham** em `server/test/operacao.test.ts`, no `describe('relógio da operação...')`:

```ts
it('banco novo nasce em tempo real', () => {
  assert.equal(estadoOperacao(criarContexto()).modo, 'REAL');
});

it('definirModo grava, emite operacao e não mexe em fase_desde', () => {
  const c = criarContexto();
  const antes = estadoOperacao(c).faseDesde;
  const vistos: unknown[] = [];
  c.eventos.ouvir((e) => vistos.push(e));
  const e = definirModo(c, 'DEMO');
  assert.equal(e.modo, 'DEMO');
  assert.equal(e.faseDesde, antes);
  assert.ok(vistos.some((v) => (v as { tipo: string }).tipo === 'operacao'));
});

it('POST /operacao/modo aceita REAL e DEMO e recusa o resto', async () => {
  const demo = await post('/operacao/modo', { modo: 'DEMO' });
  assert.equal(demo.status, 200);
  assert.equal(demo.corpo.modo, 'DEMO');
  assert.equal((await get('/simulacao/estado', { Authorization: `Bearer ${ctx.config.tokenSimulador}` })).operacao.modo, 'DEMO');
  assert.equal((await post('/operacao/modo', { modo: 'RAPIDO' })).status, 400);
  assert.equal((await post('/operacao/modo', {})).status, 400);
});
```

Em `server/test/reset.test.ts`: depois de `definirModo(ctx, 'DEMO')` e do reset, o estado volta a `modo: 'REAL'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w server`
Expected: FAIL (`modo` undefined / `definirModo` não exportado / 404 na rota).

- [ ] **Step 3: Implementar**
  - `db.ts`: coluna `modo TEXT NOT NULL DEFAULT 'REAL' CHECK (modo IN ('REAL', 'DEMO'))` na `operacao`; `VERSAO_ESQUEMA = 5`.
  - `operacao.ts`: `modo` em `LinhaOperacao`, no `SELECT` de `lerLinha` e em `paraEstado`; `criarOperacao` insere `'REAL'`;
    `definirModo` no mesmo formato de `definirVelocidade` (chama `estadoOperacao` antes, grava em `transacao`, emite
    `operacao`), sem tocar em `fase_desde`.
  - `roteiros.ts`: rota ao lado de `/operacao/velocidade`.
  - `simulacao.ts`: ler `modo` junto com `pausado, velocidade, rodada`; `modo: linhaOp?.modo ?? 'REAL'`.
  - Ajustar o `deepEqual` de `troca.test.ts:633` para incluir `modo: 'REAL'` e o rótulo do teste de versão em
    `contratos.test.ts` ("versão 2 é recriado na versão 5").

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w server && npm run typecheck -w server`
Expected: PASS, sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): modo da operação (tempo real ou demonstração)"
```

---

### Task 2: Simulador · 80 km/h em tempo real e bateria realista

**Files:**
- Modify: `simulator/src/percurso.ts` (nova `passoPorKmh`)
- Modify: `simulator/src/relogio.ts` (`Modo`, `FATOR_BATERIA_REAL`, `consumoDeBateria`)
- Modify: `simulator/src/furgoes.ts` (`OpcoesFrota.passoRealM`, `Furgao.rota`, `planejar`, `andar`, `ciclo`)
- Modify: `simulator/src/index.ts` (env, tipo `Estado`, `novaFrota`, `tick`, log de partida)
- Modify: `simulator/README.md` (tabela de comportamento e de variáveis)
- Test: `simulator/test/percurso.test.ts`, `simulator/test/relogio.test.ts`, `simulator/test/furgoes.test.ts`

**Interfaces:**
- Consumes: `operacao.modo` do `GET /simulacao/estado` (Task 1).
- Produces: `export type Modo = 'REAL' | 'DEMO'` e `export const FATOR_BATERIA_REAL = 60` (relogio.ts);
  `consumoDeBateria(emMovimento: boolean, pausado: boolean, velocidade: number, tickMs: number, modo: Modo): number`;
  `passoPorKmh(kmh: number, tickMs: number): number` (percurso.ts); `OpcoesFrota.passoRealM: number`;
  `frota.ciclo(roteiros: RoteiroRemoto[], pausado: boolean, velocidade: number, modo: Modo): Promise<void>[]`.

- [ ] **Step 1: Testes que falham**

`percurso.test.ts`:
```ts
test('passoPorKmh: 80 km/h a 250 ms anda ~5,56 m por tick', () => {
  assert.ok(Math.abs(passoPorKmh(80, 250) - 5.5556) < 0.001);
});
```

`relogio.test.ts` (os testes existentes passam a mandar `'DEMO'` como 5º argumento):
```ts
test('em tempo real a bateria gasta 1/60 do modo demonstração, e 2x dobra nos dois', () => {
  for (const mov of [true, false]) {
    const demo = consumoDeBateria(mov, false, 1, 250, 'DEMO');
    assert.ok(Math.abs(consumoDeBateria(mov, false, 1, 250, 'REAL') - demo / FATOR_BATERIA_REAL) < 1e-12);
    assert.ok(Math.abs(consumoDeBateria(mov, false, 2, 250, 'REAL') - (2 * demo) / FATOR_BATERIA_REAL) < 1e-12);
  }
  assert.equal(consumoDeBateria(true, true, 1, 250, 'REAL'), 0);
});
```

`furgoes.test.ts`: `frotaComFetchFalso` passa `passoRealM: 5` nas opções e os `ciclo(...)` existentes ganham `'DEMO'`.
Novos testes:
```ts
test('em tempo real o furgão anda o passo real; em demonstração, o passo do roteiro', async () => {
  // rota de 2 km, duracaoS 100_000 → passo demo = passoBaseM (25); passo real = 5
  const a = await frotaComFetchFalso(() => ({}));
  const b = await frotaComFetchFalso(() => ({}));
  try {
    const inicio = a.frota.posicao(1)!.posicao;
    await Promise.all(a.frota.ciclo([a.roteiro], false, 1, 'REAL'));
    await Promise.all(b.frota.ciclo([b.roteiro], false, 1, 'DEMO'));
    assert.ok(Math.abs(distanciaM(inicio, a.frota.posicao(1)!.posicao) - 5) < 0.5);
    assert.ok(Math.abs(distanciaM(inicio, b.frota.posicao(1)!.posicao) - 25) < 0.5);
  } finally { b.restaurar(); a.restaurar(); }
});

test('trocar o modo no meio da rota continua de onde estava, no ritmo novo', async () => {
  const f = await frotaComFetchFalso(() => ({}));
  try {
    const inicio = f.frota.posicao(1)!.posicao;
    await Promise.all(f.frota.ciclo([f.roteiro], false, 1, 'DEMO'));
    const meio = f.frota.posicao(1)!.posicao;
    await Promise.all(f.frota.ciclo([f.roteiro], false, 1, 'REAL'));
    assert.ok(Math.abs(distanciaM(inicio, f.frota.posicao(1)!.posicao) - 30) < 0.5); // 25 + 5, sem voltar
    assert.ok(Math.abs(distanciaM(meio, f.frota.posicao(1)!.posicao) - 5) < 0.5);
  } finally { f.restaurar(); }
});
```
Review Focus 1: um teste em que o `fetch` falso do OSRM só responde depois do primeiro `ciclo(..., 'REAL')` e de um
`ciclo(..., 'DEMO')` (furgão ainda sem rota): nenhum dos ciclos lança, e o primeiro ciclo depois da rota pronta,
em `'REAL'`, anda ~5 m.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w simulator`
Expected: FAIL (`passoPorKmh`/`FATOR_BATERIA_REAL` não exportados; furgão anda 25 m em REAL).

- [ ] **Step 3: Implementar**
  - `passoPorKmh` = `kmh / 3.6 * tickMs / 1000`.
  - `consumoDeBateria`: resultado de hoje, dividido por `FATOR_BATERIA_REAL` quando `modo === 'REAL'`.
  - `furgoes.ts`: `rota` guarda `passoDemo` (o `passoDoRoteiro` de hoje) e `passoReal` (`op.passoRealM`) no lugar de
    `passo`; `andar(f, velocidade, modo)` usa o do modo × velocidade; `ciclo` repassa o modo. O log de `planejar`
    mostra os dois ritmos (`80 km/h em tempo real; N m/s em demonstração`).
  - `index.ts`: `VELOCIDADE_REAL_KMH = numeroDoAmbiente('SIM_VELOCIDADE_REAL_KMH', 80)`; `passoRealM: passoPorKmh(VELOCIDADE_REAL_KMH, TICK_MS)`
    em `novaFrota`; `Estado.operacao.modo: Modo`; `const modo = operacao.modo ?? 'REAL'` no `tick`, passado ao
    `frota.ciclo` e ao `consumoDeBateria`. O passo das bombonas que andam sozinhas não muda. Log de partida cita os
    dois modos.
  - `simulator/README.md`: linha "Modo tempo real / demonstração" na tabela de comportamento (80 km/h; ~90 s;
    bateria 1/60 em tempo real; troca no meio da rota só muda o ritmo) e `SIM_VELOCIDADE_REAL_KMH` na de variáveis;
    ajustar o parágrafo "A rota inteira cabe em ~90 s" para dizer que isso é o modo demonstração.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w simulator && npm run typecheck -w simulator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add simulator/
git commit -m "feat(simulator): furgões a 80 km/h em tempo real e bateria realista; modo demonstração mantém ~90 s"
```

---

### Task 3: Painel · botão de modo no player

**Files:**
- Modify: `web/src/api.ts` (tipo `Modo`, `Operacao.modo`, `api.modo`)
- Modify: `web/src/componentes/Player.tsx` (botão ao lado do 1x/2x)
- Modify: `web/test/andamento.test.ts` (helper `op` ganha `modo: 'REAL'`)
- Modify: `README.md` (blocos "O player" e "Roteiro de demonstração", passo 4 do "Como abrir")

**Interfaces:**
- Consumes: `POST /api/operacao/modo` (Task 1).
- Produces: `export type Modo = 'REAL' | 'DEMO'`; `Operacao.modo: Modo`; `api.modo(modo: Modo) => Promise<Operacao>`.

- [ ] **Step 1: Implementar** o botão com o mesmo `executar(...)` e `disabled={ocupado}` dos outros. Texto
  **"Tempo real"** (`title="Furgões a 80 km/h. Clique para o modo demonstração (cada roteiro em ~90 s)"`) ou
  **"Demo 90 s"** (`title="Cada roteiro em ~90 s. Clique para tempo real (80 km/h)"`), `aria-label` equivalente.
- [ ] **Step 2: Documentar** no README: o player tem o botão de modo; a simulação nasce em tempo real (roteiro de
  120 km ≈ 1h30; o dia só vira quando todos voltam); para apresentar, trocar para **Demo 90 s**.
- [ ] **Step 3: Verificar**

Run: `npm test -w web && npm run typecheck -w web`
Expected: PASS. Conferir no navegador (`npm run dev`) que o botão alterna e que o furgão muda de ritmo.

- [ ] **Step 4: Commit**

```bash
git add web/ README.md
git commit -m "feat(web): botão de tempo real / demonstração no player"
```

---

### Task 4: Pesquisa e filtros em Clientes

**Files:**
- Modify: `server/src/consultas.ts:208-221` (`modalidade` em `listarClientes`)
- Modify: `server/test/contratos.test.ts` (teste "lista clientes com contratoAtivo")
- Create: `web/src/filtroClientes.ts`
- Test: `web/test/filtroClientes.test.ts`
- Modify: `web/src/api.ts` (`Cliente.modalidade`), `web/src/paginas/Clientes.tsx`, `web/src/estilo.css`, `README.md` (linha Clientes em "Telas")

**Interfaces:**
- Produces: `GET /api/clientes` itens com `modalidade: Frequencia | null`;
  `export type OrdemBombonas = 'DESC' | 'ASC' | null`;
  `export type FiltroClientes = { busca: string; riscos: Cliente['risco'][]; modalidades: Array<Frequencia | 'SEM'>; ordem: OrdemBombonas }`;
  `normalizar(texto: string): string`; `filtrarClientes(clientes: Cliente[], f: FiltroClientes): Cliente[]`;
  `proximaOrdem(o: OrdemBombonas): OrdemBombonas` (DESC → ASC → null → DESC).

- [ ] **Step 1: Testes que falham**

Servidor (no teste existente): o cliente com contrato tem `modalidade === 'SEMANAL'`, o sem contrato `null`.

`web/test/filtroClientes.test.ts` (clientes de exemplo montados com um helper `cli(parcial)`):
```ts
test('pesquisa ignora acento, maiúscula e espaços nas pontas, em nome, cidade e endereço', () => {
  const lista = [cli({ id: 1, cidade: 'São Paulo' }), cli({ id: 2, nome: 'Pastelaria Japonês' }), cli({ id: 3, endereco: 'Rua Pará, 1' })];
  const ids = (busca: string) => filtrarClientes(lista, { ...vazio, busca }).map((c) => c.id);
  assert.deepEqual(ids('  sao PAULO '), [1]);
  assert.deepEqual(ids('japones'), [2]);
  assert.deepEqual(ids('para'), [3]);
  assert.deepEqual(ids(''), [1, 2, 3]);
});
test('OU dentro do grupo, E entre grupos; "SEM" pega quem não tem contrato', () => {
  const lista = [cli({ id: 1, risco: 'ALTO', modalidade: 'SEMANAL' }), cli({ id: 2, risco: 'BAIXO', modalidade: null }), cli({ id: 3, risco: 'ALTO', modalidade: 'MENSAL' })];
  assert.deepEqual(filtrarClientes(lista, { ...vazio, riscos: ['ALTO'], modalidades: ['SEMANAL', 'SEM'] }).map((c) => c.id), [1]);
  assert.deepEqual(filtrarClientes(lista, { ...vazio, modalidades: ['SEM'] }).map((c) => c.id), [2]);
});
test('ordem por bombonas: DESC, ASC e null mantém a ordem recebida; empate mantém a ordem recebida', () => {
  const lista = [cli({ id: 1, bombonas: 2 }), cli({ id: 2, bombonas: 5 }), cli({ id: 3, bombonas: 2 })];
  assert.deepEqual(filtrarClientes(lista, { ...vazio, ordem: 'DESC' }).map((c) => c.id), [2, 1, 3]);
  assert.deepEqual(filtrarClientes(lista, { ...vazio, ordem: 'ASC' }).map((c) => c.id), [1, 3, 2]);
  assert.deepEqual(filtrarClientes(lista, vazio).map((c) => c.id), [1, 2, 3]);
});
test('proximaOrdem alterna DESC → ASC → null → DESC', () => {
  assert.deepEqual([proximaOrdem(null), proximaOrdem('DESC'), proximaOrdem('ASC')], ['DESC', 'ASC', null]);
});
```
(`vazio = { busca: '', riscos: [], modalidades: [], ordem: null }`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w server && npm test -w web`
Expected: FAIL (`modalidade` undefined; módulo `filtroClientes` não existe).

- [ ] **Step 3: Implementar**
  - `listarClientes`: subconsulta `(SELECT k.frequencia FROM contratos k WHERE k.cliente_id = c.id AND k.situacao = 'ATIVO') AS modalidade`.
  - `normalizar`: `trim`, `toLowerCase`, `normalize('NFD')` e remove `\p{Diacritic}`.
  - `Clientes.tsx`: caixa de pesquisa (`placeholder="Pesquisar por nome, cidade ou endereço"`); botões liga/desliga
    Alto/Médio/Baixo e Diária/Semanal/Quinzenal/Mensal/Sem contrato (`aria-pressed`); cabeçalho "Bombonas" clicável
    com seta ▼/▲ conforme a ordem; contador "X de Y clientes"; linha "Nenhum cliente com esses filtros." quando vazio.
    O resumo por risco do cabeçalho continua com `clientes` inteiro. Estado só em `useState`.
  - README: linha **Clientes** em "Telas" cita pesquisa, filtros e ordenação.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/ web/ README.md
git commit -m "feat: pesquisa, filtros por risco e modalidade e ordenação por bombonas em Clientes"
```

---

### Task 5: Contrato puxando o dia do Início

**Files:**
- Create: `web/src/diaDoContrato.ts`
- Test: `web/test/diaDoContrato.test.ts`
- Modify: `web/src/paginas/Contratos.tsx` (`vazio`, `abrirNovo`, `mudarFrequencia`, campo Início)

**Interfaces:**
- Produces: `diaDoInicio(inicio: string): { diaSemana: number; diaMes: number } | null`;
  `type CamposDia = { frequencia: Frequencia; inicio: string; diasSemana: number[]; diaMes: string }`;
  `aplicarDiaDoInicio<T extends CamposDia>(f: T): T` (devolve `f` com `diasSemana`/`diaMes` preenchidos pela regra).

- [ ] **Step 1: Testes que falham**

```ts
test('diaDoInicio: dia da semana e do mês; domingo vira segunda; data inválida é null', () => {
  assert.deepEqual(diaDoInicio('2026-11-11'), { diaSemana: 3, diaMes: 11 }); // quarta
  assert.deepEqual(diaDoInicio('2026-11-15'), { diaSemana: 1, diaMes: 15 }); // domingo → segunda
  assert.equal(diaDoInicio(''), null);
  assert.equal(diaDoInicio('2026-13-40'), null);
});
test('aplicarDiaDoInicio por frequência', () => {
  const base = { inicio: '2026-11-13', diasSemana: [1, 3], diaMes: '1' }; // sexta
  assert.deepEqual(aplicarDiaDoInicio({ ...base, frequencia: 'SEMANAL' as const }).diasSemana, [5]);
  assert.deepEqual(aplicarDiaDoInicio({ ...base, frequencia: 'QUINZENAL' as const }).diasSemana, [5]);
  assert.equal(aplicarDiaDoInicio({ ...base, frequencia: 'MENSAL' as const }).diaMes, '13');
  assert.deepEqual(aplicarDiaDoInicio({ ...base, frequencia: 'DIARIA' as const }), { ...base, frequencia: 'DIARIA' });
});
test('Início vazio não apaga os dias já marcados', () => {
  const f = { frequencia: 'SEMANAL' as const, inicio: '', diasSemana: [2, 4], diaMes: '7' };
  assert.deepEqual(aplicarDiaDoInicio(f), f);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w web`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**
  - `diaDoInicio`: validar `AAAA-MM-DD` e a data real (ida e volta por `Date.UTC`), `getUTCDay()`, 0 → 1.
  - `Contratos.tsx`: `abrirNovo` aplica `aplicarDiaDoInicio` sobre o `vazio(...)` (Semanal com o dia do Início);
    `mudarFrequencia(fr)` = `setForm(f => aplicarDiaDoInicio({ ...f, frequencia: fr }))`; o `onChange` do Início faz o
    mesmo com o `inicio` novo. `alternarDia` e os demais campos ficam como estão; `abrirEdicao` não aplica a regra.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w web && npm run typecheck -w web`
Expected: PASS. No navegador: "Novo contrato" abre com o dia de hoje marcado; trocar para Mensal mostra o dia do mês.

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat(web): contrato novo marca o dia a partir da data de início"
```

---

### Task 6: Servidor · contrato com cliente novo

**Files:**
- Modify: `server/src/contratos.ts` (`criarContrato`, nova `validarNovoCliente`, `RAIO_ATUACAO_KM`)
- Test: `server/test/contratos.test.ts`

**Interfaces:**
- Consumes: `distanciaM(a, b)` de `server/src/geo.ts`; `ctx.config.patio`; `transacao` de `db.ts`.
- Produces: `POST /api/contratos` aceita `{ novoCliente: { nome, tipo, cidade, endereco, lat, lng }, quantidade, frequencia, diasSemana, diaMes, inicio }`
  (sem `clienteId`) → 201 `ContratoDto`; `export const RAIO_ATUACAO_KM = 250`;
  `export type NovoCliente = { nome: string; tipo: string; cidade: string; endereco: string; lat: number; lng: number }`;
  `validarNovoCliente(x: unknown, patio: { lat: number; lng: number }): NovoCliente` (lança `ErroDeNegocio(400, ...)`, devolve textos com `trim`).

- [ ] **Step 1: Testes que falham** (em `contratos.test.ts`, novo `describe('contrato com cliente novo')`):

```ts
const patio = ctx.config.patio;
const kmAoNorte = (km: number) => ({ lat: patio.lat + km / 111.195, lng: patio.lng });
const novo = (parcial: Record<string, unknown> = {}) => ({
  quantidade: 2, frequencia: 'SEMANAL', diasSemana: [3], inicio: '2026-11-11',
  novoCliente: { nome: '  Bar do Zé  ', tipo: 'Bar', cidade: 'Cianorte', endereco: 'Rua A, 1', ...kmAoNorte(5), ...parcial },
});
const totalClientes = () => (ctx.db.prepare('SELECT COUNT(*) AS n FROM clientes').get() as { n: number }).n;

it('cria cliente e contrato juntos, com o nome aparado e cerca de 150 m', async () => {
  const r = await post('/contratos', novo());
  assert.equal(r.status, 201);
  assert.equal(r.corpo.cliente.nome, 'Bar do Zé');
  const c = ctx.db.prepare('SELECT raio_m, lat FROM clientes WHERE id = ?').get(r.corpo.clienteId) as { raio_m: number; lat: number };
  assert.equal(c.raio_m, 150);
});
it('recusa clienteId e novoCliente juntos, e nenhum dos dois', async () => {
  assert.equal((await post('/contratos', { ...novo(), clienteId: 1 })).status, 400);
  const { novoCliente: _, ...sem } = novo();
  assert.equal((await post('/contratos', sem)).status, 400);
});
it('recusa nome só de espaços, lat não numérico e ponto a mais de 250 km, sem gravar cliente', async () => {
  const antes = totalClientes();
  for (const parcial of [{ nome: '   ' }, { lat: 'abc' }, { tipo: '' }, { nome: 'x'.repeat(121) }, kmAoNorte(251)])
    assert.equal((await post('/contratos', novo(parcial))).status, 400, JSON.stringify(parcial));
  assert.equal(totalClientes(), antes);
  assert.equal((await post('/contratos', novo(kmAoNorte(249)))).status, 201);
});
it('regra do contrato inválida não deixa cliente órfão', async () => {
  const antes = totalClientes();
  assert.equal((await post('/contratos', { ...novo(), diasSemana: [] })).status, 400);
  assert.equal(totalClientes(), antes);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w server`
Expected: FAIL (400 "clienteId é obrigatório." no primeiro teste).

- [ ] **Step 3: Implementar**
  - `criarContrato`: exatamente um de `clienteId`/`novoCliente` (mensagem `'Informe o cliente: clienteId ou novoCliente, um dos dois.'`);
    validar o novo cliente e a regra **antes** de gravar; com `novoCliente`, `INSERT INTO clientes (nome, tipo, cidade, endereco, lat, lng)`
    e o `INSERT` do contrato dentro de uma `transacao`. O caminho de `clienteId` continua igual.
  - Mensagens de `validarNovoCliente`: `'Nome do cliente é obrigatório.'`, `'Nome do cliente deve ter até 120 caracteres.'`,
    `'Tipo do cliente é obrigatório.'`, `'Cidade do cliente é obrigatória.'`, `'Endereço do cliente é obrigatório.'`,
    `'Marque no mapa onde o cliente fica.'` (lat/lng ausentes ou não finitos),
    `'O cliente fica fora da área de atuação (até 250 km do pátio).'`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w server && npm run typecheck -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): contrato cria cliente novo junto, numa transação, até 250 km do pátio"
```

---

### Task 7: Painel · cliente novo no "Novo contrato"

**Files:**
- Create: `web/src/componentes/MapaPonto.tsx`
- Modify: `web/src/api.ts` (`EntradaContrato`), `web/src/paginas/Contratos.tsx`, `web/src/estilo.css`
- Modify: `README.md` (linha Contratos em "Telas"), `docs/regras-de-negocio.md` (onde fala do cadastro de contratos/clientes)

**Interfaces:**
- Consumes: `POST /api/contratos` com `novoCliente` (Task 6); `aplicarDiaDoInicio` (Task 5).
- Produces: `EntradaContrato = { clienteId?: number; novoCliente?: NovoClienteEntrada; ... }` com
  `NovoClienteEntrada = { nome: string; tipo: string; cidade: string; endereco: string; lat: number; lng: number }`;
  `export const RAIO_ATUACAO_KM = 250` e
  `MapaPonto(props: { ponto: Ponto | null; patio: Local; aoEscolher: (p: Ponto) => void })` em `MapaPonto.tsx`.

- [ ] **Step 1: `MapaPonto`**: `MapContainer` pequeno centrado no pátio (zoom 11), tiles como em `MapaRoteiros`,
  marcador do pátio, `useMapEvents({ click })`: se `L.latLng(patio).distanceTo(e.latlng) > RAIO_ATUACAO_KM * 1000`,
  não chama `aoEscolher` e mostra "Fora da área de atuação (250 km do pátio)."; senão chama `aoEscolher` e some o
  aviso. Com `ponto`, desenha marcador + `Circle` de 150 m.
- [ ] **Step 2: Formulário** (`Contratos.tsx`):
  - `Formulario` ganha `clienteNovo: boolean` e `novo: { nome: string; tipo: string; cidade: string; endereco: string; ponto: Ponto | null }`.
  - "Novo contrato" sempre habilitado; abre com `clienteNovo: true`. Campos Nome (`maxLength={120}`), Tipo (`<select>`
    com os `tipo` distintos de `clientes`, em ordem alfabética), Cidade, Endereço e o `MapaPonto` (precisa de
    `config.patio` do `useMonitoramento`).
  - Link "usar cliente já cadastrado" só se `semContrato.length > 0` (troca para o `<select>` de hoje, com o
    primeiro já escolhido); link "cadastrar cliente novo" para voltar.
  - `paraEntrada` manda `novoCliente` (com `lat/lng` do ponto) ou `clienteId`. Antes de enviar, no cliente novo:
    campo vazio → `'Preencha nome, tipo, cidade e endereço.'`; sem ponto → `'Marque no mapa onde o cliente fica.'`.
  - Depois de salvar, segue o fluxo de hoje (`setEditando(salvo)`, `recarregar()`). A edição não muda.
- [ ] **Step 3: Documentar**: README (Contratos: cria contrato com cliente novo marcado no mapa) e
  `docs/regras-de-negocio.md` (cliente novo nasce com o contrato, cerca de 150 m, até 250 km do pátio).
- [ ] **Step 4: Verificar**

Run: `npm test && npm run typecheck`
Expected: PASS. No navegador: criar um cliente novo clicando no mapa; ele aparece em Clientes e no Mapa; clique a
mais de 250 km mostra o aviso; salvar sem ponto mostra o erro.

- [ ] **Step 5: Commit**

```bash
git add web/ README.md docs/regras-de-negocio.md
git commit -m "feat(web): novo contrato com cliente novo marcado no mapa"
```

---

### Task 8: Acompanhar um furgão em Coletas

**Files:**
- Create: `web/src/acompanhamento.ts`
- Test: `web/test/acompanhamento.test.ts`
- Modify: `web/src/paginas/Coletas.tsx`, `web/src/componentes/MapaRoteiros.tsx`, `web/src/estilo.css`, `README.md` (linha Coletas em "Telas")

**Interfaces:**
- Produces: `posicaoDoAcompanhado(roteiros: Roteiro[], id: number | null): Ponto | null` (posição do roteiro `id` se
  ele existe, está `EM_ANDAMENTO` e tem `posicao`; senão `null`);
  `MapaRoteiros` ganha props `acompanhado: Ponto | null`, `aoSoltar: () => void`, `reenquadrar: number`.

- [ ] **Step 1: Teste que falha** (Review Focus 5):

```ts
test('posicaoDoAcompanhado só segue furgão em andamento e com posição', () => {
  const r = (id: number, status: StatusRoteiro, posicao: Ponto | null) => ({ ...rotBase, id, status, posicao });
  const lista = [r(1, 'EM_ANDAMENTO', { lat: 1, lng: 2 }), r(2, 'CONCLUIDO', { lat: 3, lng: 4 }), r(3, 'EM_ANDAMENTO', null)];
  assert.deepEqual(posicaoDoAcompanhado(lista, 1), { lat: 1, lng: 2 });
  assert.equal(posicaoDoAcompanhado(lista, 2), null);
  assert.equal(posicaoDoAcompanhado(lista, 3), null);
  assert.equal(posicaoDoAcompanhado(lista, 9), null); // sumiu (reset, outro dia)
  assert.equal(posicaoDoAcompanhado(lista, null), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w web`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**
  - `Coletas.tsx`: estado `acompanhado: number | null` e `reenquadrar: number`. Botão "Acompanhar" / "Parar de
    acompanhar" dentro do `<li>`, depois do botão do cartão, só para roteiro `EM_ANDAMENTO`. Acompanhar = selecionar
    o furgão + `setAcompanhado(id)`. Parar pelo botão = `setAcompanhado(null)` + `reenquadrar + 1` (seleção mantida).
    Desmarcar o cartão desliga. Um `useEffect` desliga quando `posicaoDoAcompanhado(roteiros, acompanhado)` for `null`
    com `acompanhado !== null` (concluiu, sumiu), sem reenquadrar. A troca de `rodada` zera também `acompanhado`.
  - `MapaRoteiros.tsx`: componente interno `Seguir({ alvo, aoSoltar })`: ao ligar (alvo passa de null para ponto)
    `map.setView(alvo, 15)`; a cada novo alvo `map.panTo(alvo)`; enquanto ligado, `map.on('dragstart', aoSoltar)`
    (desliga com `off` no cleanup). `Enquadrar` não reenquadra enquanto `acompanhado !== null` e inclui `reenquadrar`
    na `chave` (parar pelo botão volta a enquadrar a rota do selecionado).
  - README: linha **Coletas** em "Telas" cita o botão Acompanhar.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: PASS. No navegador: acompanhar um furgão em rota; o mapa segue; arrastar solta; "Parar de acompanhar"
enquadra a rota dele; ao concluir, o botão some e o mapa fica parado.

- [ ] **Step 5: Commit**

```bash
git add web/ README.md
git commit -m "feat(web): acompanhar um furgão no mapa de Coletas"
```
