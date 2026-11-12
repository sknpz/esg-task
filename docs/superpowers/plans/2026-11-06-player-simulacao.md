# Player da simulação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Barra de player (play/pause, reset, 1x/2x, data, andamento do dia) controlando a demonstração com contratos e rotas.

**Architecture:** O estado do player mora na linha `operacao` do servidor (pausado, velocidade, rodada). O servidor escala o relógio e o prazo de "sem sinal" pela velocidade, congela tudo pausado e faz o reset síncrono (apaga e repopula pelo seed, rodada + 1). O simulador lê velocidade/pausa/rodada em `GET /simulacao/estado` a cada ciclo, escala os passos sem mudar o ciclo de 250 ms, manda `X-Rodada` em toda escrita e recomeça do zero quando a rodada muda. O web troca o botão do cabeçalho por uma barra `Player` e recarrega tudo no evento SSE `reset`.

**Tech Stack:** Node 23.6+ com TypeScript por type stripping, Express, `node:sqlite`, `node:test`; React + Vite + Leaflet no web.

**Spec:** `docs/superpowers/specs/2026-11-06-player-simulacao-design.md` (ler junto; o plano argumenta a partir dele).

## Global Constraints

- Código, nomes, comentários, mensagens de erro e textos de tela em português, no estilo dos arquivos vizinhos.
- TypeScript compatível com type stripping do Node (sem `enum`, sem parameter properties, `import type` para tipos).
- Nenhuma dependência nova.
- Ciclo do simulador continua 250 ms (`TICK_MS`); em 2x só o passo cresce.
- Velocidades possíveis: exatamente `1` e `2`. Reset volta para `1`, pausado.
- Texto da confirmação do reset: "Voltar a simulação ao começo? Tudo o que aconteceu (coletas, alertas, contratos criados) será apagado." Botões: "Voltar ao começo" e "Cancelar".
- Marcas da barra de andamento: "Manhã", "Furgões na rua", "Fim do dia".
- Commits locais na `feat/contratos-rotas`, mensagem no padrão `feat(server): …` / `feat(simulator): …` / `feat(web): …`, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Nunca dar push.**
- Testes: `cd server && npm test`, `cd simulator && npm test`, `cd web && npm test` (criado na Task 5); typecheck: `npm run typecheck` na raiz.

## Review Focus

1. **Reset no meio de uma rota com pedidos do simulador no ar** → nenhum furgão, traçado ou leitura da rodada velha entra na nova (Task 3: `posicao`/`trajeto`/`telemetria` com `X-Rodada` antiga → 409, sem evento SSE).
2. **Trocar a velocidade no meio da manhã** → a fase não termina na hora nem pula: a fração já decorrida se mantém (Task 1: `definirVelocidade` reescala `fase_desde`).
3. **Ficar muitos minutos pausado antes do primeiro play** → nenhum BATERIA_BAIXA nem SEM_SINAL nasce (Task 2: varredura pausada não abre alerta; continuar desloca `ultimo_sinal`. Task 4: consumo zero pausado).
4. **Reset duas vezes seguidas, ou em 2x pausado** → cada reset sobe a rodada e volta pausado em 1x (Task 3).
5. **Duas abas abertas** → as duas recebem `reset` e recarregam; a seleção `?b=` do mapa é limpa (Task 3 testa o evento; Task 5 trata no web).

---

### Task 1: Estado da operação: nasce pausado, velocidade, rodada, dia

**Files:**
- Modify: `server/src/db.ts` (tabela `operacao`, `VERSAO_ESQUEMA` 3 → 4)
- Modify: `server/src/operacao.ts` (`EstadoOperacao`, `estadoOperacao`, `avancarOperacao`, nova `definirVelocidade`)
- Modify: `server/src/calendario.ts` (nova `diaDeOperacao`)
- Modify: `server/src/rotas/roteiros.ts` (rota `POST /operacao/velocidade`)
- Modify: `server/src/rotas/simulacao.ts` (`operacao` do estado ganha `velocidade` e `rodada`)
- Test: `server/test/operacao.test.ts`, `server/test/calendario.test.ts`; ajustar `server/test/operacao-dia.test.ts` e `server/test/troca.test.ts`

**Interfaces:**
- Produces:
  - `export type Velocidade = 1 | 2` (em `operacao.ts`)
  - `EstadoOperacao = { data: string; diaSemana: number; fase: Fase; pausado: boolean; velocidade: Velocidade; rodada: number; dia: number; faseDesde: string; faseDuracaoMs: number | null }` — `faseDuracaoMs = fasePausaS * 1000 / velocidade` em MANHA e FIM, `null` em ROTAS; `faseDesde` é o `fase_desde` do banco.
  - `definirVelocidade(ctx: Contexto, velocidade: Velocidade, agora = Date.now()): EstadoOperacao`
  - `diaDeOperacao(inicial: string, data: string): number` (em `calendario.ts`)
  - Colunas novas em `operacao`: `velocidade INTEGER NOT NULL DEFAULT 1 CHECK (velocidade IN (1, 2))`, `rodada INTEGER NOT NULL DEFAULT 1`.
  - `GET /simulacao/estado` → `operacao: { data, pausado, velocidade, rodada }`.
  - `POST /operacao/velocidade` body `{ velocidade: 1 | 2 }` → 200 com `EstadoOperacao`; outro valor → 400 `{ erro }`.

- [ ] **Step 1: Write the failing tests** (em `operacao.test.ts` e `calendario.test.ts`)

```ts
it('banco novo nasce pausado, em 1x, rodada 1, dia 1', () => {
  const ctx = criarContexto();
  const e = estadoOperacao(ctx);
  assert.equal(e.pausado, true);
  assert.equal(e.velocidade, 1);
  assert.equal(e.rodada, 1);
  assert.equal(e.dia, 1);
  assert.equal(e.fase, 'MANHA');
});

it('pausado na criação, a manhã não avança', () => {
  const ctx = criarContexto({ fasePausaS: 5 });
  const t0 = Date.parse(estadoOperacao(ctx).faseDesde);
  avancarOperacao(ctx, t0 + 60_000);
  assert.equal(estadoOperacao(ctx).fase, 'MANHA');
});

it('em 2x a manhã dura metade', () => {
  const ctx = criarContexto({ fasePausaS: 10 });
  continuar(ctx);
  definirVelocidade(ctx, 2);
  const t0 = Date.parse(estadoOperacao(ctx).faseDesde);
  assert.equal(estadoOperacao(ctx).faseDuracaoMs, 5000);
  avancarOperacao(ctx, t0 + 4900);
  assert.equal(estadoOperacao(ctx).fase, 'MANHA');
  avancarOperacao(ctx, t0 + 5100);
  assert.equal(estadoOperacao(ctx).fase, 'ROTAS');
});

it('trocar a velocidade no meio da fase mantém a fração decorrida', () => {
  const ctx = criarContexto({ fasePausaS: 10 });
  continuar(ctx, 1_000_000);
  ctx.db.prepare('UPDATE operacao SET fase_desde = ?').run(new Date(1_000_000).toISOString());
  definirVelocidade(ctx, 2, 1_004_000); // 40% de 10 s em 1x
  assert.equal(Date.parse(estadoOperacao(ctx).faseDesde), 1_002_000); // 40% de 5 s em 2x
});

it('POST /operacao/velocidade aceita 1 e 2 e recusa o resto', async () => { /* subirApi; 2 → 200 com velocidade 2; 3 → 400; "2" → 400 */ });

// calendario.test.ts
it('diaDeOperacao conta dias de operação, pulando domingo', () => {
  assert.equal(diaDeOperacao('2026-11-09', '2026-11-09'), 1);
  assert.equal(diaDeOperacao('2026-11-09', '2026-11-14'), 6);
  assert.equal(diaDeOperacao('2026-11-09', '2026-11-16'), 7);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL nos testes novos (`definirVelocidade`/`diaDeOperacao` não existem, `pausado` vem `false`).

- [ ] **Step 3: Implement**
  - `db.ts`: colunas novas, `VERSAO_ESQUEMA = 4` (banco antigo se recria sozinho, comportamento existente).
  - `estadoOperacao`: o INSERT inicial grava `pausado = 1`. `paraEstado` preenche os campos novos (`dia` via `diaDeOperacao(config.dataInicialOperacao, data)`).
  - `avancarOperacao`: `passouPausa` usa `fasePausaS * 1000 / velocidade`.
  - `definirVelocidade`: grava a velocidade e, fora de ROTAS, reescala `fase_desde` para `agora - (agora - fase_desde) * vAntiga / vNova` (pausado, usa o início da pausa no lugar de `agora`); emite `operacao`.
  - Testes existentes que avançam a operação depois de criá-la passam a chamar `continuar(ctx)` logo após a criação (nos helpers `cenario`/equivalentes de `operacao-dia.test.ts` e `troca.test.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test && node node_modules/typescript/bin/tsc --noEmit -p .`
Expected: todos passam (os 128 antigos + os novos), typecheck sem erro.

- [ ] **Step 5: Commit**

```bash
git add server/src server/test
git commit -m "feat(server): operação nasce pausada, com velocidade 1x/2x e rodada"
```

---

### Task 2: Pausado congela o "sem sinal"; 2x encurta o prazo

**Files:**
- Modify: `server/src/regras.ts` (`verificarSemSinal`)
- Modify: `server/src/operacao.ts` (`continuar` desloca `ultimo_sinal`)
- Modify: `server/src/index.ts` (intervalo da varredura)
- Test: `server/test/regras.test.ts`

**Interfaces:**
- Consumes: `EstadoOperacao.pausado`, `EstadoOperacao.velocidade` (Task 1).
- Produces: `verificarSemSinal(ctx, agora)` com a mesma assinatura; não abre nada pausado; prazo `semSinalSegundos * 1000 / velocidade`.

- [ ] **Step 1: Write the failing tests**

```ts
it('pausado, a varredura não abre SEM_SINAL', () => {
  const ctx = criarContexto({ semSinalSegundos: 45 });
  estadoOperacao(ctx); // nasce pausado
  ctx.db.prepare('UPDATE dispositivos SET ultimo_sinal = ?').run(new Date(Date.now() - 3_600_000).toISOString());
  assert.equal(verificarSemSinal(ctx).length, 0);
});

it('em 2x o prazo de sem sinal cai pela metade', () => {
  const ctx = criarContexto({ semSinalSegundos: 45 });
  continuar(ctx);
  definirVelocidade(ctx, 2);
  const agora = Date.now();
  // um dispositivo calado há 30 s: fora do prazo em 2x (22,5 s), dentro em 1x
  ctx.db.prepare('UPDATE dispositivos SET ultimo_sinal = ? WHERE id = (SELECT MIN(id) FROM dispositivos)').run(new Date(agora - 30_000).toISOString());
  assert.equal(verificarSemSinal(ctx, agora).length, 1);
});

it('continuar desloca o último sinal pelo tempo pausado', () => {
  const ctx = criarContexto();
  continuar(ctx, 1_000_000);
  pausar(ctx, 2_000_000);
  ctx.db.prepare('UPDATE dispositivos SET ultimo_sinal = ?').run(new Date(1_990_000).toISOString());
  continuar(ctx, 2_060_000); // 60 s pausado
  const { ultimo_sinal } = ctx.db.prepare('SELECT ultimo_sinal FROM dispositivos LIMIT 1').get() as { ultimo_sinal: string };
  assert.equal(Date.parse(ultimo_sinal), 2_050_000);
});
```

(Ajustar ao valor de retorno real de `verificarSemSinal`: a lista de alertas abertos.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL nos três testes novos.

- [ ] **Step 3: Implement**
  - `verificarSemSinal`: lê a operação; pausada → `[]`; prazo dividido pela velocidade. Sem operação criada, comporta-se como hoje (1x, não pausado).
  - `continuar`: na mesma transação, soma a duração da pausa ao `ultimo_sinal` de todos os dispositivos (só quando `inicioDaPausa` é conhecido, como já é feito com `fase_desde`).
  - `index.ts`: intervalo da varredura calculado sobre metade do prazo (`semSinalSegundos / 2`), para 2x não atrasar a detecção.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src server/test
git commit -m "feat(server): pausa congela o prazo de sem sinal e 2x o encurta"
```

---

### Task 3: Reset e checagem de rodada

**Files:**
- Create: `server/src/reset.ts`
- Modify: `server/src/eventos.ts` (tipo `'reset'` no `Evento`)
- Modify: `server/src/operacao.ts` (exportar o necessário para limpar `inicioDaPausa`)
- Modify: `server/src/rotas/simulacao.ts` (nova `exigirRodadaAtual`)
- Modify: `server/src/rotas/roteiros.ts` (rota `POST /operacao/reset`; `exigirRodadaAtual` nas 4 rotas do simulador)
- Modify: `server/src/rotas/telemetria.ts` (`exigirRodadaAtual` no `POST /telemetria`)
- Test: `server/test/reset.test.ts`

**Interfaces:**
- Consumes: `estadoOperacao`, `definirVelocidade`, `pausar`, `continuar` (Task 1), `popularSeVazio(db, config)` (seed).
- Produces:
  - `resetarSimulacao(ctx: Contexto): EstadoOperacao` — síncrono; apaga todas as linhas de todas as tabelas, roda `popularSeVazio`, recria a operação (pausada, 1x, rodada anterior + 1, manhã da data inicial planejada), limpa `inicioDaPausa`, emite `{ tipo: 'reset', dados: estado }` e depois `operacao`.
  - `exigirRodadaAtual(ctx: Contexto): RequestHandler` — header `X-Rodada` ausente → segue (hardware real não manda); presente e diferente da rodada atual → 409 `{ erro: 'Rodada encerrada: a simulação foi reiniciada' }`.
  - `POST /operacao/reset` (sem token, como `pausar`) → 200 com `EstadoOperacao`.

- [ ] **Step 1: Write the failing tests** (`server/test/reset.test.ts`)

```ts
it('reset deixa o banco igual a um recém-criado, inclusive o histórico do seed', () => {
  const novo = criarContexto();
  estadoOperacao(novo);
  const ctx = criarContexto();
  continuar(ctx);
  definirVelocidade(ctx, 2);
  criarContrato(ctx, { /* cliente sem contrato do seed */ });
  // + avançar até ROTAS e registrar uma troca, para sujar paradas/movimentacoes/alertas
  resetarSimulacao(ctx);
  for (const t of ['clientes', 'contratos', 'bombonas', 'dispositivos', 'alertas', 'movimentacoes', 'leituras', 'roteiros', 'paradas', 'simulacao_comandos'])
    assert.equal(contar(ctx, t), contar(novo, t), t);
  const e = estadoOperacao(ctx);
  assert.deepEqual([e.pausado, e.velocidade, e.fase, e.data, e.dia], [true, 1, 'MANHA', '2026-11-09', 1]);
});

it('cada reset sobe a rodada', () => { /* rodada 1 → reset → 2 → reset → 3 */ });

it('reset emite "reset" com o estado novo', () => { /* ctx.eventos.ouvir; primeiro evento do reset tem tipo 'reset' e dados.rodada === 2 */ });

it('pedido do simulador com rodada antiga é recusado e não emite nada', async () => {
  // subirApi; reset; POST /roteiros/:id/posicao com Authorization do simulador e X-Rodada: 1 → 409;
  // nenhum evento 'furgao' emitido. Mesmo para /roteiros/:id/trajeto e /telemetria (token de um dispositivo atual).
});

it('sem X-Rodada a telemetria continua aceita', async () => { /* POST /telemetria sem o header → 202 */ });
```

(`contar(ctx, tabela)` é um helper local do arquivo de teste.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && node --test test/reset.test.ts`
Expected: FAIL (`resetarSimulacao` não existe).

- [ ] **Step 3: Implement** — o reset é uma função síncrona (o `node:sqlite` é síncrono), então nenhum pedido entra no meio; apagar respeitando as chaves estrangeiras (filhas antes das mães) dentro de `transacao`, e só depois chamar `popularSeVazio` (que abre a própria transação; `transacao` não aninha). Ler a rodada antiga antes de apagar.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test && node node_modules/typescript/bin/tsc --noEmit -p .`
Expected: PASS, typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add server/src server/test
git commit -m "feat(server): reset da simulação e recusa de pedidos da rodada anterior"
```

---

### Task 4: Simulador: velocidade, pausa congelada e reset

**Files:**
- Create: `simulator/src/relogio.ts`
- Modify: `simulator/src/furgoes.ts` (`ciclo` recebe velocidade; `OpcoesFrota` recebe cabeçalhos)
- Modify: `simulator/src/index.ts`
- Test: `simulator/test/relogio.test.ts`, `simulator/test/furgoes.test.ts`

**Interfaces:**
- Consumes: `GET /simulacao/estado` → `operacao: { data: string; pausado: boolean; velocidade: 1 | 2; rodada: number }` (Task 1); 409 de rodada antiga (Task 3).
- Produces (`relogio.ts`, funções puras):
  - `consumoDeBateria(emMovimento: boolean, pausado: boolean, velocidade: number, tickMs: number): number` — 0 pausado; senão o consumo atual (`0.05/3000` e `0.01/3000` por ms) × `tickMs` × velocidade.
  - `silencioDoCenarioMs(semSinalSegundos: number, velocidade: number): number` — `(semSinalSegundos + 25) * 1000 / velocidade`.
  - `estenderSilencio(caladoAte: number | undefined, pausado: boolean, decorridoMs: number): number | undefined` — pausado e calado → soma `decorridoMs`; senão devolve igual.
  - `rodadaMudou(vista: number | undefined, atual: number): boolean` — `true` só se `vista` existe e é diferente.
- Produces (`furgoes.ts`): `ciclo(roteiros: RoteiroRemoto[], pausado: boolean, velocidade: number): Promise<void>[]`; `OpcoesFrota.cabecalhos: () => Record<string, string>` mesclado em todo POST.

- [ ] **Step 1: Write the failing tests**

```ts
// relogio.test.ts
test('pausado não gasta bateria', () => assert.equal(consumoDeBateria(false, true, 1, 250), 0));
test('2x gasta o dobro', () => assert.equal(consumoDeBateria(true, false, 2, 250), 2 * consumoDeBateria(true, false, 1, 250)));
test('silêncio do cenário em 2x', () => assert.equal(silencioDoCenarioMs(45, 2), 35_000));
test('pausado, o silêncio é estendido', () => assert.equal(estenderSilencio(10_000, true, 250), 10_250));
test('rodada', () => { assert.equal(rodadaMudou(undefined, 1), false); assert.equal(rodadaMudou(1, 1), false); assert.equal(rodadaMudou(1, 2), true); });

// furgoes.test.ts: com fetch falso (OSRM devolvendo uma reta de 1 km, POSTs devolvendo 200)
test('em 2x o furgão anda o dobro por ciclo', async () => { /* duas frotas iguais; após planejar, 1 ciclo com velocidade 1 e outro com 2: distância percorrida 2x */ });
test('todo POST da frota leva os cabeçalhos', async () => { /* cabecalhos: () => ({ 'X-Rodada': '7' }); o POST de posição chega com X-Rodada 7 */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd simulator && npm test`
Expected: FAIL (`relogio.ts` não existe; `ciclo` ignora a velocidade).

- [ ] **Step 3: Implement**
  - `furgoes.ts`: em `andar`, passo `rota.passo * velocidade`; a pausa da parada desconta `velocidade` ticks por ciclo.
  - `index.ts`: `tick` passa `operacao.velocidade` à frota; `mover`/`seguir` usam `passo * velocidade`; bateria por `consumoDeBateria`; `caladoAte` por `estenderSilencio` (decorrido = tempo real desde o ciclo anterior); cenário SEM_SINAL usa `silencioDoCenarioMs` com a velocidade atual (sai o `silencioMs` fixo lido no início; `semSinalSegundos` continua vindo de `/configuracao`).
  - Rodada: guardar a última vista; se `rodadaMudou`, descartar `aparelhos`, `dispositivos`, `dataVista` e recriar a frota antes de sincronizar (o simulador recomeça como se tivesse acabado de subir). `enviarLeitura` e a frota mandam `X-Rodada` com a rodada atual. 409 em leitura é silencioso (pedido da rodada velha).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd simulator && npm test && node node_modules/typescript/bin/tsc --noEmit -p .`
Expected: PASS, typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add simulator
git commit -m "feat(simulator): velocidade 2x, pausa congelada e recomeço no reset"
```

---

### Task 5: Web: barra de player e README

**Files:**
- Create: `web/src/andamento.ts`, `web/src/componentes/Player.tsx`, `web/test/andamento.test.ts`
- Modify: `web/src/api.ts` (`Operacao` com os campos novos; `velocidade`, `resetar`)
- Modify: `web/src/monitoramento.tsx` (evento `reset`)
- Modify: `web/src/App.tsx` (sai o bloco `.operacao` do cabeçalho; `<Player />` logo abaixo do `<header>`)
- Modify: `web/src/paginas/Mapa.tsx` (limpa `?b=` quando a rodada muda)
- Modify: `web/src/estilo.css`
- Modify: `web/package.json` (`"test": "node --test \"test/**/*.test.ts\""`), `package.json` raiz (`test` inclui `-w web`)
- Modify: `README.md` ("Como rodar" e "Roteiro de demonstração")

**Interfaces:**
- Consumes: `EstadoOperacao` (Task 1) como `Operacao`; `POST /operacao/velocidade`, `POST /operacao/reset`, evento SSE `reset` (Tasks 1 e 3); `Roteiro` com `status`, `trajeto`, `posicao` (já existe).
- Produces:
  - `api.velocidade(v: 1 | 2): Promise<Operacao>`, `api.resetar(): Promise<Operacao>`
  - `andamentoDoDia(op: Operacao, roteiros: Roteiro[], agora: number): number` em `[0, 1]`: MANHA ocupa `[0, 0.1]` pela fração `(agora - faseDesde) / faseDuracaoMs`; ROTAS ocupa `[0.1, 0.9]` pela média de `fracaoDoTrajeto` dos roteiros do dia (CONCLUIDO = 1, PLANEJADO = 0; sem roteiros = 1); FIM ocupa `[0.9, 1]` como a manhã.
  - `fracaoDoTrajeto(trajeto: [number, number][], posicao: { lat: number; lng: number }): number` — distância acumulada até o ponto do trajeto mais próximo da posição, sobre o comprimento total.

- [ ] **Step 1: Write the failing tests** (`web/test/andamento.test.ts`)

```ts
test('manhã pela metade = 5%', () => perto(andamentoDoDia(op({ fase: 'MANHA', faseDesde: iso(0), faseDuracaoMs: 10_000 }), [], 5_000), 0.05));
test('rotas: um concluído e um parado no começo = 50%', () =>
  perto(andamentoDoDia(op({ fase: 'ROTAS', faseDuracaoMs: null }), [rot('CONCLUIDO'), rot('PLANEJADO')], 0), 0.5));
test('rotas sem roteiros = 90%', () => perto(andamentoDoDia(op({ fase: 'ROTAS', faseDuracaoMs: null }), [], 0), 0.9));
test('fim passado do prazo = 100%, sem passar de 1', () => assert.equal(andamentoDoDia(op({ fase: 'FIM', faseDesde: iso(0), faseDuracaoMs: 5_000 }), [], 9_000), 1));
test('posição no meio do trajeto = 0,5', () => perto(fracaoDoTrajeto([[0, 0], [0, 1], [0, 2]], { lat: 0, lng: 1 }), 0.5));
```

(`op`, `rot`, `iso` e `perto(a, b)` (diferença < 1e-9) são helpers locais do teste; o resultado é limitado a `[0, 1]`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test`
Expected: FAIL (`andamento.ts` não existe).

- [ ] **Step 3: Implement `andamento.ts`** e rodar `cd web && npm test` → PASS.

- [ ] **Step 4: Implement o player e o reset no web**
  - `Player.tsx`: botão play/pause (verde `.botao`, ▶ pausado / ⏸ rodando), botão ⟲ que abre a confirmação na própria barra (texto e botões das Global Constraints), botão de velocidade mostrando `1x`/`2x` que alterna, data `formatarDataOperacao(data)` + `· dia N`, trilho com as três marcas. O andamento é recalculado a cada ~250 ms só enquanto rodando (pausado, congela) e nunca diminui dentro da mesma `data` (guardar o máximo por data num `useRef`).
  - `monitoramento.tsx`: no evento `reset`, limpar avisos, roteiros e alertas abertos e chamar `recarregar()`.
  - `Mapa.tsx`: quando `operacao.rodada` muda em relação a um valor já visto (não na primeira carga), `selecionar(null)`.
  - CSS: faixa abaixo de `.topo`, fundo `--superficie`, borda inferior `--borda`; abaixo de 640 px quebra em duas linhas (controles e data em cima, trilho embaixo), sem rolagem horizontal.
  - README: em "Como rodar", rodar de um clone no disco do PC (no pendrive FAT32 o `npm install` da raiz falha e o banco fica lento a ponto de os furgões andarem aos pulos); em "Roteiro de demonstração", o player (começa parado → play → 2x → reset entre apresentações).

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test` na raiz
Expected: tudo passa. Depois, `npm run dev` e conferir no navegador (http://localhost:5173): nasce parado; play; 2x sem pulos; pausar 1 min não abre alerta; reset no meio da rota sem furgão, traçado ou aviso sobrando, com duas abas abertas; layout em largura de celular.

- [ ] **Step 6: Commit**

```bash
git add web package.json README.md
git commit -m "feat(web): barra de player com play/pause, reset e 2x"
```
