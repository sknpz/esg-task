# Contratos de coleta e rotas do dia · plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada cliente passa a ter um contrato com frequência de coleta; um calendário simulado gera as coletas
de cada dia, divide entre furgões e o simulador faz as rotas no mapa, trocando bombonas em cada parada.

**Architecture:** O **servidor é o dono do relógio e das regras**: guarda a data de operação, gera as paradas a
partir dos contratos, divide e ordena os roteiros (módulos puros `calendario.ts` e `roteirizacao.ts`), carrega as
vazias e executa a troca quando o furgão informa a parada. O **simulador é o dono da verdade física**: busca a rota
pelas ruas (uma chamada OSRM por roteiro), move o furgão, informa ao servidor o trajeto, a posição e o que o
coletor achou em cada parada. Bombonas dentro de um furgão (`bombonas.roteiro_id` não nulo) só mudam de lugar pela
troca, nunca pela RN04. No código, "roteiro" é a rota de um furgão num dia (para não confundir com `server/src/rotas/`,
que são os roteadores do Express); na tela continua "rota".

**Tech Stack:** Node 23.6+ rodando TypeScript direto, Express 5, `node:sqlite`, `node:test`, React + Vite + Leaflet.

**Spec:** `docs/superpowers/specs/2026-11-06-contratos-rotas-design.md`

## Global Constraints

- **Base:** branch `feat/ajustes-bio-oleo` com o código dos ajustes já mergeado no `main` (ver Task 0). Os nomes que
  este plano usa dela: `VERSAO_ESQUEMA` em `db.ts`, `movimentacoes.litros`, `coletar(ctx, codigo, { litros, observacao })`,
  `litrosEsperados(db, clienteId, n)` e `avaliarColeta(...)` em `rendimento.ts`, `Config.coletaHistoricoN`,
  `PASSO_FURGAO_M` e `simulator/src/percurso.ts` (`distanciaM`, `comprimentoM`, `passoDaViagem`).
- Node 23.6+, SQLite embutido, **nenhuma dependência nova** (roteirização feita à mão).
- OSRM público: **uma chamada por roteiro por dia**, nada de chamada por trecho.
- Datas de operação são texto `YYYY-MM-DD`, calculadas em UTC. Dia da semana: 1 = segunda … 6 = sábado, 0 = domingo.
  **Domingo nunca tem coleta.**
- Horários de leituras, alertas e movimentações continuam no relógio real (`agoraIso()`).
- Parâmetros (env, padrão de demonstração): `FURGAO_CAPACIDADE` 8 bombonas, `FROTA_MAXIMA` 4, `DATA_INICIAL_OPERACAO`
  `2026-11-09`, `FASE_PAUSA_S` 5 (manhã e fim do dia); no simulador `DURACAO_ROTEIRO_S` 90, `PAUSA_PARADA_MS` 1000,
  `VENDAS_POR_DIA` 0.4 (~1 venda a cada 2 ou 3 dias simulados, no total).
- `npm test` e `npm run typecheck` passam ao fim de toda task. Testes antigos que usam índices do seed
  (`clienteId: 6`, `BO-0001`…`BO-0020` e os clientes 1 a 25) continuam valendo: tudo que é novo no seed entra **depois**.
- Textos de tela em português, no tom dos atuais. As vendas clandestinas são frequentes na vida real; os textos
  nunca dizem que são raras, só que a demonstração as deixa raras.
- Não fazer push nem PR (o Matheus revisa no navegador antes).
- Testes que criam contratos começam com `ctx.db.exec('DELETE FROM contratos')` ou usam um cliente criado no próprio
  teste: a partir da Task 6 o seed já traz contratos, e os testes das Tasks 2, 4 e 5 precisam continuar passando.

## Review Focus

1. **Bombona do furgão passando pela cerca de outro cliente ou pelo pátio na saída** → nada muda de status; só a
   troca move bombona de roteiro. Teste na Task 4 (`processarLeitura` ignora RN04 com `roteiro_id`).
2. **Mesmo sumiço contado duas vezes** (venda vista pelo rastreador e depois "não encontrada" na parada) → risco
   sobe 1, não 2; e alerta `FORA_DA_AREA` antigo, de antes da última entrega, não impede a contagem. Teste na Task 5.
3. **Contrato editado ou criado no meio do dia** → as paradas do dia já geradas não mudam; o efeito aparece no
   próximo dia. Teste na Task 4.
4. **Dia que não cabe na frota ou parada maior que a capacidade** → sobra vira `NAO_ATENDIDA`, nenhum roteiro passa
   da capacidade, nenhuma parada é dividida. Teste na Task 3.
5. **Servidor reiniciado com roteiro em andamento** → roteiro concluído na hora, sem bombona presa em `EM_ROTA`, e o
   dia avança. Teste na Task 5.

---

### Task 0: Conferir a base

**Files:** nenhum.

- [ ] **Step 1: Verificar** que a branch de trabalho parte do `main` com os ajustes:
  `grep -n "VERSAO_ESQUEMA" server/src/db.ts && test -f server/src/rendimento.ts && test -f simulator/src/percurso.ts && grep -n "PASSO_FURGAO_M" simulator/src/index.ts`
  → as quatro coisas existem. Se faltar qualquer uma, **parar** e avisar: os commits dos ajustes ainda não chegaram.
- [ ] **Step 2: Run** `npm test` e `npm run typecheck` → passam. Anotar o número de testes (linha de base).
- [ ] **Step 3: Branch** `git switch -c feat/contratos-rotas`.

### Task 1: Calendário (funções puras)

**Files:**
- Create: `server/src/calendario.ts`
- Test: `server/test/calendario.test.ts`

**Interfaces:**
- Produces:
  - `type Frequencia = 'DIARIA' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL'`
  - `type RegraContrato = { frequencia: Frequencia; diasSemana: number[]; diaMes: number | null; inicio: string }`
  - `diaDaSemana(data: string): number` (0 = domingo)
  - `somarDias(data: string, dias: number): string`
  - `proximoDiaOperacao(data: string): string` (dia seguinte, pulando domingo)
  - `caiNaData(regra: RegraContrato, data: string): boolean`
  - `proximasColetas(regra: RegraContrato, aPartirDe: string, n: number): string[]` (inclui `aPartirDe` se cair)
  - `validarRegra(regra: unknown): RegraContrato` (lança `Error` com mensagem em português)

- [ ] **Step 1: Write the failing tests**

```ts
const r = (x: Partial<RegraContrato>): RegraContrato => ({ frequencia: 'DIARIA', diasSemana: [], diaMes: null, inicio: '2026-11-02', ...x });

it('diária cai de segunda a sábado, nunca no domingo', () => {
  assert.equal(caiNaData(r({}), '2026-11-09'), true);   // seg
  assert.equal(caiNaData(r({}), '2026-11-14'), true);   // sáb
  assert.equal(caiNaData(r({}), '2026-11-15'), false);  // dom
});
it('nada cai antes do início', () => assert.equal(caiNaData(r({ inicio: '2026-11-10' }), '2026-11-09'), false));
it('semanal cai nos dias marcados', () => {
  const s = r({ frequencia: 'SEMANAL', diasSemana: [1, 3, 5] });
  assert.deepEqual(proximasColetas(s, '2026-11-09', 4), ['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16']);
});
it('quinzenal conta 14 dias a partir da primeira ocorrência depois do início', () => {
  const q = r({ frequencia: 'QUINZENAL', diasSemana: [4], inicio: '2026-11-03' }); // 1ª quinta: 05/11
  assert.deepEqual(proximasColetas(q, '2026-11-01', 3), ['2026-11-05', '2026-11-19', '2026-12-03']);
});
it('mensal no dia 31 cai no último dia do mês', () => {
  const m = r({ frequencia: 'MENSAL', diaMes: 31 });
  assert.deepEqual(proximasColetas(m, '2026-11-01', 2), ['2026-11-30', '2026-12-31']);
});
it('mensal que cai no domingo passa para a segunda', () => {
  const m = r({ frequencia: 'MENSAL', diaMes: 15 });          // 15/11/2026 é domingo
  assert.equal(caiNaData(m, '2026-11-15'), false);
  assert.equal(caiNaData(m, '2026-11-16'), true);
});
it('mensal que vira segunda no mês seguinte ainda cai', () => {
  const m = r({ frequencia: 'MENSAL', diaMes: 31, inicio: '2026-01-01' }); // 31/05/2026 é domingo
  assert.equal(caiNaData(m, '2026-06-01'), true);
});
it('proximoDiaOperacao pula o domingo', () => assert.equal(proximoDiaOperacao('2026-11-14'), '2026-11-16'));
it('validarRegra recusa regra incoerente', () => {
  for (const ruim of [{ frequencia: 'SEMANAL', diasSemana: [] }, { frequencia: 'SEMANAL', diasSemana: [0] },
                      { frequencia: 'QUINZENAL', diasSemana: [1, 2] }, { frequencia: 'MENSAL', diaMes: 32 },
                      { frequencia: 'ANUAL' }, { frequencia: 'DIARIA', inicio: '09/11/2026' }])
    assert.throws(() => validarRegra({ diasSemana: [], diaMes: null, inicio: '2026-11-09', ...ruim }));
});
```

- [ ] **Step 2: Run** `npm test -w server` → FAIL (módulo não existe).
- [ ] **Step 3: Implement** em `calendario.ts`, com `Date.UTC` e strings `YYYY-MM-DD`. Mensal: calcular a data
  ajustada (dia limitado ao último do mês, domingo → +1) para o mês da data **e** para o mês anterior; cai se uma
  delas for igual à data e ≥ início. `validarRegra` normaliza: `diasSemana` vazio e `diaMes` nulo quando não se
  aplicam; `diasSemana` ordenado e sem repetição, valores de 1 a 6; `QUINZENAL` exatamente um dia; `MENSAL` `diaMes`
  inteiro 1–31; `inicio` válido no formato.
- [ ] **Step 4: Run** `npm test -w server` → todos passam.
- [ ] **Step 5: Commit** `feat(server): calendário de coletas por frequência`

### Task 2: Contratos — esquema e API (RN19)

**Files:**
- Modify: `server/src/db.ts` (ESQUEMA, `VERSAO_ESQUEMA = 3`)
- Create: `server/src/contratos.ts`, `server/src/rotas/contratos.ts`
- Modify: `server/src/app.ts` (montar o roteador)
- Test: `server/test/contratos.test.ts`

**Interfaces:**
- Consumes: `validarRegra`, `proximasColetas`, `RegraContrato` (Task 1).
- Produces (esquema, todas as tabelas novas desta feature, para subir a versão uma vez só):
  - `contratos (id, cliente_id NOT NULL, quantidade INTEGER NOT NULL CHECK (quantidade >= 1), frequencia TEXT CHECK (...4 valores),
    dias_semana TEXT NOT NULL DEFAULT '' /* "1,3,5" */, dia_mes INTEGER, inicio TEXT NOT NULL,
    situacao TEXT NOT NULL DEFAULT 'ATIVO' CHECK (situacao IN ('ATIVO','ENCERRADO')), retirada_pendente INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL)` + `CREATE UNIQUE INDEX contratos_um_ativo ON contratos (cliente_id) WHERE situacao = 'ATIVO'`
  - `operacao (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, fase TEXT NOT NULL CHECK (fase IN ('MANHA','ROTAS','FIM')), fase_desde TEXT NOT NULL, pausado INTEGER NOT NULL DEFAULT 0)`
  - `roteiros (id, data TEXT NOT NULL, numero INTEGER NOT NULL /* 1..frota */, status TEXT CHECK (status IN ('PLANEJADO','EM_ANDAMENTO','CONCLUIDO')),
    trajeto TEXT /* JSON [[lat,lng],...] */, distancia_m REAL, lat REAL, lng REAL, iniciado_em TEXT, concluido_em TEXT)`
  - `paradas (id, data TEXT NOT NULL, roteiro_id INTEGER REFERENCES roteiros, ordem INTEGER, cliente_id INTEGER NOT NULL, contrato_id INTEGER,
    motivo TEXT CHECK (motivo IN ('COLETA','RETIRADA')), vazias INTEGER NOT NULL /* quantas deixar */, demanda INTEGER NOT NULL,
    status TEXT CHECK (status IN ('PENDENTE','FEITA','NAO_ATENDIDA')), resultado TEXT /* JSON */, feita_em TEXT)`
  - `bombonas.roteiro_id INTEGER REFERENCES roteiros (id)` (nulo fora de furgão)
  - `movimentacoes.incidente INTEGER NOT NULL DEFAULT 0`
  - `listarContratos(db: Banco, hoje: string): ContratoDto[]` e `contratoPorId(db, id, hoje)`, onde
    `ContratoDto = { id; clienteId; cliente: { nome; cidade }; quantidade; frequencia; diasSemana: number[]; diaMes: number | null; inicio; situacao; proximas: string[] /* 3 datas a partir de hoje */ }`
  - `criarContrato(ctx: Contexto, entrada: unknown): ContratoDto` e `editarContrato(ctx, id: number, entrada: unknown): ContratoDto`
    (`entrada` = `{ clienteId, quantidade, frequencia, diasSemana, diaMes, inicio }`; `editarContrato` aceita também
    `situacao: 'ENCERRADO'`, que grava `retirada_pendente = 1`; contrato encerrado não volta a ativo).
  - Rotas: `GET /api/contratos`, `GET /api/contratos/:id`, `POST /api/contratos` (201), `PUT /api/contratos/:id`;
    `GET /api/clientes` passa a trazer `contratoAtivo: boolean`.
  - `dataOperacao(ctx: Contexto): string` em `contratos.ts`: `operacao.data` da linha 1, ou `config.dataInicialOperacao`
    se ela ainda não existir (a linha é criada na Task 4). `proximas` é calculado a partir dessa data. `Config.dataInicialOperacao: string` (env `DATA_INICIAL_OPERACAO`, padrão `'2026-11-09'`).

- [ ] **Step 1: Write the failing tests** (cliente sem contrato: usar um cliente criado no próprio teste, porque o
  seed ainda não tem contratos até a Task 6)

```ts
it('cria contrato semanal e devolve as próximas datas', async () => {
  const c = await post('/contratos', { clienteId: clienteNovo(), quantidade: 2, frequencia: 'SEMANAL', diasSemana: [1], inicio: '2026-11-02' });
  assert.equal(c.status, 201);
  assert.deepEqual(c.corpo.proximas, ['2026-11-09', '2026-11-16', '2026-11-23']);
});
it('recusa segundo contrato ativo para o mesmo cliente (RN19)', ...);           // 409
it('recusa quantidade < 1, cliente inexistente e regra inválida', ...);          // 400, 404, 400
it('encerrar marca retirada pendente e libera um novo contrato', ...);
it('lista clientes com contratoAtivo', ...);
it('banco na versão 2 é recriado na versão 3', ...);                             // mesmo padrão do db.test.ts dos ajustes
```

- [ ] **Step 2: Run** `npm test -w server` → FAIL.
- [ ] **Step 3: Implement.** Erros com `ErroDeNegocio` (400 validação, 404 cliente/contrato, 409 contrato ativo
  duplicado ou edição de encerrado). Rotas no estilo de `rotas/operacao.ts` (função `responder`).
- [ ] **Step 4: Run** `npm test -w server` → todos passam.
- [ ] **Step 5: Commit** `feat(server): contratos de coleta (RN19)`

### Task 3: Roteirização (funções puras)

**Files:**
- Create: `server/src/roteirizacao.ts`
- Test: `server/test/roteirizacao.test.ts`

**Interfaces:**
- Produces:
  - `type ParadaPlano = { clienteId: number; lat: number; lng: number; demanda: number }`
  - `dividirEmRoteiros(patio: Ponto, paradas: ParadaPlano[], capacidade: number, frotaMaxima: number): { roteiros: ParadaPlano[][]; naoAtendidas: ParadaPlano[] }`
    — cada roteiro já vem **ordenado**.
  - `ordenarParadas(patio: Ponto, paradas: ParadaPlano[]): ParadaPlano[]` (circuito pátio → paradas → pátio)
  - `comprimentoCircuitoM(patio: Ponto, paradas: ParadaPlano[]): number` (linha reta, `distanciaM` de `geo.ts`)

- [ ] **Step 1: Write the failing tests**

```ts
it('nenhum roteiro passa da capacidade e nenhuma parada é dividida', () => {
  const { roteiros } = dividirEmRoteiros(P, vinteParadasAoRedor(), 8, 4);
  for (const r of roteiros) assert.ok(soma(r) <= 8);
});
it('separa por região: paradas ao norte e ao sul não dividem furgão', () => {
  // 4 ao norte e 4 ao sul, demanda 2 cada, capacidade 8 → 2 roteiros, cada um de um lado
});
it('o que não cabe na frota vira não atendida', () => {
  const { roteiros, naoAtendidas } = dividirEmRoteiros(P, paradas(10, 2), 4, 2); // 20 de demanda, cabe 8
  assert.equal(roteiros.length, 2); assert.equal(soma(naoAtendidas), 12);
});
it('parada maior que a capacidade vira não atendida', ...);
it('dia sem paradas não gera roteiro', () => assert.deepEqual(dividirEmRoteiros(P, [], 8, 4), { roteiros: [], naoAtendidas: [] }));
it('ordenação não é pior que a ordem de entrada e começa pela mais próxima do pátio', ...);
```

- [ ] **Step 2: Run** `npm test -w server` → FAIL.
- [ ] **Step 3: Implement.** Varredura: ordenar por ângulo a partir do pátio, começando logo depois do **maior vão
  angular** entre paradas vizinhas (para não cortar uma região no meio); encher o roteiro atual até a próxima não
  caber, então abrir outro; passando de `frotaMaxima`, o resto é `naoAtendidas`; parada com `demanda > capacidade` vai
  direto para `naoAtendidas`. Ordem: vizinho mais próximo a partir do pátio, depois 2-opt até não melhorar.
- [ ] **Step 4: Run** `npm test -w server` → todos passam.
- [ ] **Step 5: Commit** `feat(server): divisão e ordem das paradas por furgão`

### Task 4: Operação do dia — relógio, planejamento e pausa (RN20, RN23, RN24)

**Files:**
- Create: `server/src/operacao.ts`, `server/src/rotas/roteiros.ts`
- Modify: `server/src/config.ts` (`furgaoCapacidade`, `frotaMaxima`, `fasePausaS`)
- Modify: `server/src/regras.ts` (RN04 ignora bombona com `roteiro_id`)
- Modify: `server/src/eventos.ts` (`Evento.tipo` ganha `'operacao' | 'roteiro'`)
- Modify: `server/src/index.ts` (timer de 1 s chamando `avancarOperacao`)
- Modify: `server/src/consultas.ts` (`LinhaBombona.roteiro_id`; `bombonaDto` expõe `roteiroId: number | null`)
- Test: `server/test/operacao-dia.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `Config.dataInicialOperacao`.
- Produces:
  - `estadoOperacao(ctx: Contexto): { data: string; diaSemana: number; fase: 'MANHA'|'ROTAS'|'FIM'; pausado: boolean }` — cria a
    linha 1 com `data = config.dataInicialOperacao`, `fase = 'MANHA'` se ela não existir.
  - `planejarDia(ctx: Contexto, data: string): void` — idempotente (se já há paradas na data, não faz nada).
  - `iniciarRoteiros(ctx: Contexto, data: string): void` — carrega as vazias e passa os roteiros a `EM_ANDAMENTO`.
  - `avancarOperacao(ctx: Contexto, agora = Date.now()): void` — máquina de fases.
  - `pausar(ctx)`, `continuar(ctx)`.
  - `roteirosDoDia(db, config, data): { data; roteiros: RoteiroDto[]; naoAtendidas: ParadaDto[] }`, com
    `RoteiroDto = { id; numero; status; distanciaM: number | null; trajeto: [number, number][] | null; posicao: Ponto | null; capacidade: number; carga: number /* soma das demandas */; paradas: ParadaDto[] }` e
    `ParadaDto = { id; ordem: number | null; cliente: { id; nome; cidade; lat; lng }; motivo; vazias; demanda; status; resultado: ResultadoParada | null }`.
  - Rotas: `GET /api/operacao`, `POST /api/operacao/pausar`, `POST /api/operacao/continuar`, `GET /api/roteiros?data=`
    (padrão: data de operação). Eventos SSE: `operacao` (o `estadoOperacao`) a cada mudança de fase/pausa, `roteiro`
    (um `RoteiroDto`) a cada mudança de roteiro.

Comportamento:
- `planejarDia`: para cada contrato `ATIVO` com `caiNaData(regra, data)` → parada `COLETA` com `vazias = quantidade`;
  para cada contrato `ENCERRADO` com `retirada_pendente = 1` → parada `RETIRADA` com `vazias = 0` (e zera a pendência).
  `demanda = max(vazias, bombonas EM_CLIENTE do cliente sem roteiro)`. Divide com `dividirEmRoteiros`; cria um roteiro
  `PLANEJADO` por grupo, paradas com `ordem`; o que sobra fica `NAO_ATENDIDA` sem roteiro.
- `iniciarRoteiros` (RN24): para cada roteiro, em ordem, pega vazias do `PATIO` (`roteiro_id IS NULL`, menor código
  primeiro) e marca `status = 'EM_ROTA', cliente_id = <cliente da parada>, roteiro_id = <roteiro>` com movimentação
  `SAIDA_PARA_ENTREGA`. Faltando vazias, as paradas sem vazia suficiente viram `NAO_ATENDIDA` (mensagem no resultado:
  "sem bombonas vazias no pátio"). Roteiro sem nenhuma parada atendível é apagado.
- `avancarOperacao` (nada acontece com `pausado = 1`): `MANHA` → (planeja ao entrar; depois de `fasePausaS`) inicia e
  vai para `ROTAS`; `ROTAS` → quando não há roteiro `EM_ANDAMENTO` na data, `FIM`; `FIM` → depois de `fasePausaS`,
  `data = proximoDiaOperacao(data)`, `MANHA`. `fase_desde` em horário real; a pausa estende a fase (ao continuar,
  `fase_desde` é deslocado pelo tempo pausado).
- RN04 em `processarLeitura`: se `b.roteiro_id !== null`, não confirma chegada (só grava a leitura e a posição).

- [ ] **Step 1: Write the failing tests** (com `fasePausaS: 0` e `avancarOperacao` chamada à mão)

```ts
it('gera as paradas do dia a partir dos contratos e respeita a capacidade', () => {
  contratos([{ cliente: 1, freq: 'DIARIA', qtd: 2 }, { cliente: 6, freq: 'SEMANAL', dias: [2], qtd: 1 }]);
  planejarDia(ctx, '2026-11-09');                                     // segunda: só o diário
  const { roteiros } = roteirosDoDia(ctx.db, ctx.config, '2026-11-09');
  assert.deepEqual(roteiros.flatMap((r) => r.paradas.map((p) => p.cliente.id)), [1]);
});
it('domingo não gera parada', ...);
it('planejar duas vezes não duplica', ...);
it('contrato criado depois do planejamento não entra no dia, entra no próximo', ...);
it('encerrado gera RETIRADA com 0 vazias no dia seguinte, uma vez só', ...);
it('iniciar carrega vazias do pátio no furgão (EM_ROTA, roteiro_id, cliente da parada)', ...);
it('sem vazias suficientes a parada vira NAO_ATENDIDA', ...);
it('fases: MANHA → ROTAS → FIM → MANHA do próximo dia útil; sábado vai para segunda', ...);
it('pausado não muda de fase nem de data', ...);
it('bombona em furgão dentro da cerca do destino continua EM_ROTA (RN04 não vale)', async () => {
  // leitura POST /telemetria na coordenada do cliente → status continua EM_ROTA
});
```

- [ ] **Step 2: Run** `npm test -w server` → FAIL.
- [ ] **Step 3: Implement** conforme as interfaces e o comportamento acima. Toda escrita em `transacao`; eventos
  emitidos depois.
- [ ] **Step 4: Run** `npm test -w server` → todos passam.
- [ ] **Step 5: Commit** `feat(server): calendário da operação e roteiros do dia (RN20, RN23, RN24)`

### Task 5: Troca na parada, fim do roteiro e sumiço descoberto (RN21, RN22)

**Files:**
- Modify: `server/src/operacoes.ts` (extrair a parte transacional de `coletar` para reuso)
- Modify: `server/src/operacao.ts` (`registrarTroca`, `concluirRoteiro`, `registrarTrajeto`, `registrarPosicao`, `retomarAposReinicio`)
- Modify: `server/src/rotas/roteiros.ts`, `server/src/rotas/simulacao.ts` (`/simulacao/estado` ganha `operacao` e `roteiros`)
- Modify: `server/src/consultas.ts` (risco soma `NAO_ENCONTRADA` com `incidente = 1`; mesma soma em `ultimoIncidente`)
- Modify: `server/src/index.ts` (chamar `retomarAposReinicio` ao subir)
- Test: `server/test/troca.test.ts`

**Interfaces:**
- Consumes: Task 4; `litrosEsperados`, `avaliarColeta` (ajustes).
- Produces:
  - `coletarEmTransacao(ctx: Contexto, b: LinhaBombona, opcoes: { litros: number | null; observacao?: string; roteiroId?: number | null }): unknown[]`
    — o que `coletar` fazia dentro da transação (status `EM_ROTA`, `cliente_id NULL`, movimentação `COLETA`/`RECUPERACAO`
    com litros, resolver alertas de cerca, RN18); grava também `roteiro_id`. Devolve os alertas tocados. `coletar` passa a usá-la.
  - `type ResultadoParada = { deixadas: string[]; levadas: { codigo: string; litros: number }[]; naoEncontradas: { codigo: string; incidente: boolean }[]; observacao?: string }`
  - `registrarTroca(ctx, roteiroId: number, paradaId: number, entrada: { encontradas: { codigo: string; litros: number }[] }): ParadaDto`
  - `concluirRoteiro(ctx, roteiroId: number): RoteiroDto`
  - `registrarTrajeto(ctx, roteiroId, entrada: { pontos: [number, number][]; distanciaM: number })`, `registrarPosicao(ctx, roteiroId, entrada: { lat: number; lng: number })`
  - `retomarAposReinicio(ctx: Contexto): void`
  - Rotas, **com `Authorization: Bearer <tokenSimulador>`** (401 sem): `POST /api/roteiros/:id/trajeto`, `POST /api/roteiros/:id/posicao`,
    `POST /api/roteiros/:id/paradas/:paradaId/troca`, `POST /api/roteiros/:id/concluir`.
  - `/simulacao/estado` passa a devolver também `operacao: { data, pausado }`, `roteiros: [{ id, numero, paradas: [{ id, ordem, status, clienteId, nome, lat, lng, litrosEsperados: number | null, capacidades: number[] }], bombonas: string[] }]`
    (só `EM_ANDAMENTO`; `capacidades` = `capacidade_l` das bombonas do cliente, para o simulador gerar litros) e, em cada
    dispositivo, `roteiroId` e `clienteId`.

Comportamento de `registrarTroca` (tudo numa transação; parada precisa ser `PENDENTE` do roteiro `EM_ANDAMENTO`, senão 409):
1. **Antigas** = bombonas com `cliente_id` da parada, `status IN ('EM_CLIENTE','EXTRAVIADA')`, `roteiro_id IS NULL`.
2. Para cada antiga **encontrada** (código em `encontradas` e `status = 'EM_CLIENTE'`): `coletarEmTransacao` com os litros
   (validação da RN17: inteiro 0..capacidade, senão 400) e `roteiroId`.
3. Para cada antiga **não encontrada**: movimentação `NAO_ENCONTRADA`; `incidente = 1` **só se** não existe alerta
   `FORA_DA_AREA` dessa bombona com `aberto_em` ≥ a última movimentação `ENTREGA_CONCLUIDA` dela nesse cliente (sem
   entrega registrada, desde sempre). Status vira `EXTRAVIADA` (se não era) e abre `EXTRAVIO` crítico se não houver um aberto,
   mensagem "Não encontrada na coleta de <cliente>".
4. **Vazias** = bombonas com `roteiro_id` do roteiro e `cliente_id` da parada: viram `EM_CLIENTE`, `roteiro_id NULL`,
   movimentação `ENTREGA_CONCLUIDA` (observação "Deixada na troca"). Na `RETIRADA` não há vazias.
5. Parada `FEITA` com `resultado` JSON e `feita_em`. Emite `bombona` de cada tocada, `alerta`s e `roteiro`.

`concluirRoteiro`: paradas ainda `PENDENTE` viram `NAO_ATENDIDA`; bombonas do roteiro com `cliente_id NULL` (cheias)
viram `PATIO` (`RETORNO_AO_PATIO`); vazias que sobraram (cliente não atendido) também voltam ao `PATIO` com `cliente_id NULL`;
todas com `roteiro_id NULL`. Roteiro `CONCLUIDO`.

`retomarAposReinicio`: para cada roteiro `EM_ANDAMENTO`, faz `registrarTroca` das paradas pendentes em ordem
considerando encontradas todas as antigas `EM_CLIENTE`, com litros = `round(litrosEsperados ?? capacidade × 0.7)`
limitado à capacidade; depois `concluirRoteiro`.

- [ ] **Step 1: Write the failing tests**

```ts
it('troca normal: leva as cheias com litros, deixa as vazias', async () => {
  // cliente com 2 bombonas e contrato qtd 2; planeja + inicia; troca com as 2 encontradas
  assert.deepEqual(statusDe(antigas), ['EM_ROTA', 'EM_ROTA']);
  assert.deepEqual(statusDe(vazias), ['EM_CLIENTE', 'EM_CLIENTE']);
  assert.equal(movimentacaoDe(antigas[0]).litros, 30);
});
it('coleta pela troca dispara a RN18 com histórico baixo', ...);
it('cliente novo: só deixa vazias', ...);
it('retirada: leva tudo e não deixa nada', ...);
it('litros inválidos na troca → 400 e nada muda', ...);
it('venda vista pelo rastreador e depois não encontrada: risco sobe só 1', async () => {
  const antes = await risco(c);
  // abrirAlerta FORA_DA_AREA para a bombona depois da ENTREGA_CONCLUIDA; troca sem ela
  assert.equal((await risco(c)).incidentes, antes.incidentes + 1);
});
it('rastreador mudo (sem FORA_DA_AREA desde a entrega): não encontrada conta incidente e abre EXTRAVIO', ...);
it('FORA_DA_AREA antigo, de antes da última entrega, não impede a contagem', ...);
it('2 de 3 sumidas: regra roda para cada uma', ...);
it('troca em parada já feita → 409; sem token → 401', ...);
it('concluir devolve cheias e vazias que sobraram ao pátio, sem roteiro_id', ...);
it('reinício conclui o roteiro em andamento e o dia avança', ...);
it('/simulacao/estado traz operacao e roteiros em andamento com paradas', ...);
```

- [ ] **Step 2: Run** `npm test -w server` → FAIL.
- [ ] **Step 3: Implement** conforme acima. `coletar` continua com a mesma assinatura e os testes antigos passando.
- [ ] **Step 4: Run** `npm test -w server` → todos passam.
- [ ] **Step 5: Commit** `feat(server): troca na parada e sumiço descoberto na coleta (RN21, RN22)`

### Task 6: Seed — 50 clientes, 49 contratos e estoque do pátio

**Files:**
- Modify: `server/src/seed.ts`
- Test: `server/test/seed-contratos.test.ts`

**Interfaces:**
- Consumes: tabelas da Task 2; `caiNaData`, `proximoDiaOperacao` (Task 1); `planejarDia`/`roteirosDoDia` (Task 4) nos testes.
- Produces: 50 clientes (os 25 atuais + 25 novos, no fim de `CLIENTES`, nas mesmas regiões, cada um sobre uma rua);
  contrato `ATIVO` para os 49 primeiros, `inicio = '2026-11-02'`; o **último cliente sem contrato e sem bombona** (para
  criar o contrato ao vivo). Quantidade do contrato dos clientes antigos = bombonas que o seed manda para ele (alocadas +
  em rota); clientes novos com 1 a 3 bombonas novas `EM_CLIENTE` com histórico de litros no padrão dos ajustes.
  Pátio com pelo menos `FURGAO_CAPACIDADE × FROTA_MAXIMA` (32) bombonas `PATIO` (RN24), novas entrando no fim de `plano`.

- [ ] **Step 1: Write the failing tests**

```ts
it('50 clientes, 49 contratos ativos e 1 cliente sem contrato nem bombona', ...);
it('quantidade do contrato = bombonas do cliente', ...);
it('pátio tem estoque para a frota inteira (RN24)', ...);
it('mistura de frequências: há DIARIA, SEMANAL com mais de um dia, QUINZENAL, MENSAL e clientes com 2 ou 3 bombonas', ...);
it('os 12 primeiros dias de operação têm de 12 a 25 paradas e cabem na frota', () => {
  let data = '2026-11-09';
  for (let i = 0; i < 12; i++, data = proximoDiaOperacao(data)) {
    const ctx = criarContexto({ fasePausaS: 0 });
    planejarDia(ctx, data);
    const { roteiros, naoAtendidas } = roteirosDoDia(ctx.db, ctx.config, data);
    const paradas = roteiros.flatMap((r) => r.paradas).length;
    assert.ok(paradas >= 12 && paradas <= 25, `${data}: ${paradas}`);
    assert.equal(naoAtendidas.length, 0);
  }
});
it('o primeiro dia (09/11) tem mensal do dia 9 e sai com pelo menos 2 furgões', ...);
```

- [ ] **Step 2: Run** `npm test -w server` → FAIL.
- [ ] **Step 3: Implement.** Não mexer na ordem nem nos índices de `CLIENTES[0..24]`, `ALOCACOES` e das bombonas
  existentes. Escolher a mistura de frequências (ordem de grandeza do spec, ajustada até o teste de calibração passar).
- [ ] **Step 4: Run** `npm test` → todos passam (os antigos provam que os índices não mudaram).
- [ ] **Step 5: Commit** `feat(server): seed com 50 clientes, contratos e estoque do pátio`

### Task 7: Simulador — furgões, pausa, vendas do dia e venda com rastreador arrancado

**Files:**
- Create: `simulator/src/furgoes.ts`
- Modify: `simulator/src/index.ts`
- Modify: `server/src/rotas/simulacao.ts` (cenário `VENDA_SILENCIOSA`, bombona opcional)
- Test: `simulator/test/furgoes.test.ts`, `server/test/simulacao.test.ts` (novo ou existente)

**Interfaces:**
- Consumes: `/simulacao/estado` e as rotas com token da Task 5; `percurso.ts` (ajustes).
- Produces:
  - Server: `CENARIOS` inclui `'VENDA_SILENCIOSA'`. Para esse tipo, `bombona` é opcional: sem ela, o servidor escolhe uma
    bombona `EM_CLIENTE`, sem `roteiro_id`, de um cliente com contrato que cai no **próximo dia de operação** (sem candidato,
    qualquer `EM_CLIENTE`; sem nenhuma, 409). Resposta 201 com a bombona escolhida.
  - Simulador, em `furgoes.ts` (puras, testáveis):
    - `gerarLitros(esperado: number | null, capacidade: number, rnd: () => number): number` — em torno de `esperado`
      (±15%), 1 vez em 12 abaixo de 40% do esperado; sem esperado, 70% da capacidade ±15%; sempre inteiro em 0..capacidade.
    - `passoDoRoteiro(distanciaM: number, passoBaseM: number, ticksMax: number): number` (= `passoDaViagem`, com
      `ticksMax` descontando as pausas das paradas).
    - `indicesDasParadas(pontosDaRota: Ponto[], paradas: Ponto[]): number[]` — índice do ponto da geometria mais próximo
      de cada parada, em ordem crescente.
  - Comportamento em `index.ts`:
    - Furgão por roteiro `EM_ANDAMENTO`: uma consulta OSRM com `pátio;p1;…;pn;pátio`; envia `POST /roteiros/:id/trajeto`;
      anda com `passoDoRoteiro` (rota inteira em ~`DURACAO_ROTEIRO_S`); envia `posicao` a cada tick em movimento; em cada
      parada espera `PAUSA_PARADA_MS` e manda `troca` com `encontradas` = bombonas do cliente que o simulador sabe que estão
      lá (`EM_CLIENTE` no servidor, sem `desvio` e sem `arrancada`) e litros de `gerarLitros`; no pátio, `concluir`.
      Sem resposta do OSRM, espera e tenta de novo (regra atual).
    - Bombonas com `roteiroId` não têm viagem própria: a posição é a do furgão daquele roteiro.
    - Simulador reiniciado com roteiro em andamento: recomeça do ponto da última parada `FEITA` (ou do pátio).
    - `operacao.pausado`: ninguém se move (furgão, venda, devolução) e não há sorteio; parados continuam mandando leitura.
    - Vendas do dia: quando `operacao.data` muda, com probabilidade `VENDAS_POR_DIA` aplica `VENDA` a uma bombona `EM_CLIENTE`
      sem roteiro. Substitui o `SIM_AUTO_VENDA_MIN`.
    - `VENDA_SILENCIOSA`: marca `arrancada`; a bombona nunca mais manda leitura e não é encontrada na parada.

- [ ] **Step 1: Write the failing tests**

```ts
// simulator
it('gerarLitros fica entre 0 e a capacidade e perto do esperado na maioria das vezes', ...);
it('gerarLitros sem histórico usa 70% da capacidade', ...);
it('passoDoRoteiro: rota longa termina no tempo alvo; curta usa o passo base', ...);
it('indicesDasParadas acha o ponto mais próximo de cada parada, em ordem', ...);
// server
it('VENDA_SILENCIOSA sem bombona escolhe cliente com coleta no próximo dia', ...);
it('VENDA_SILENCIOSA sem bombona em cliente → 409', ...);
```

- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** conforme acima.
- [ ] **Step 4: Run** `npm test` e `npm run typecheck` → passam.
- [ ] **Step 5: Verificar com o OSRM real:** `npm run dev`; num dia completo, os furgões saem, param em cada cliente
  (~1 s), voltam ao pátio, e a data avança sozinha em ~2 min. `GET /api/roteiros` mostra paradas `FEITA` com resultado.
- [ ] **Step 6: Commit** `feat(simulator): furgões fazem os roteiros do dia trocando bombonas`

### Task 8: Painel — data da operação, pausa e tela de Contratos

**Files:**
- Modify: `web/src/api.ts` (tipos e chamadas: `Operacao`, `Contrato`, `Roteiro`, `Parada`, `ResultadoParada`; `Cliente.contratoAtivo`; `Cenario` com `'VENDA_SILENCIOSA'`)
- Modify: `web/src/monitoramento.tsx` (eventos `operacao` e `roteiro` no estado compartilhado)
- Modify: `web/src/App.tsx` (abas "Coletas do dia" e "Contratos"; data simulada e botão pausar/continuar no topo)
- Create: `web/src/paginas/Contratos.tsx`
- Modify: `web/src/formato.ts` (`rotuloFrequencia`, `formatarDataOperacao`: "seg, 09/11")

**Interfaces:**
- Consumes: API das Tasks 2, 4 e 5.
- Produces: `api.operacao()`, `api.pausar()`, `api.continuar()`, `api.contratos()`, `api.criarContrato(e)`, `api.editarContrato(id, e)`,
  `api.roteiros(data?)`, `api.simular(bombona: string | null, tipo: Cenario)`; `useMonitoramento()` passa a expor
  `operacao: Operacao | null` e `roteiros: Roteiro[]` (do dia atual, atualizados por SSE).

- [ ] **Step 1: Implement.** Tela Contratos conforme o rascunho aprovado (`contratos.html`): tabela (cliente,
  frequência legível, bombonas, próxima coleta) com botão "Novo contrato"; formulário de criar/editar com cliente (no
  novo: só clientes sem contrato ativo), quantidade, frequência (rádio), dias da semana (seg–sáb; um só na quinzenal),
  dia do mês, início, e "Encerrar contrato" com confirmação. As próximas datas vêm só da API (`proximas`), sem copiar a
  regra para o front: antes de salvar, o formulário mostra "salve para ver as próximas coletas". Erros da API aparecem
  no formulário.
- [ ] **Step 2: Run** `npm run typecheck` → sem erro.
- [ ] **Step 3: Verificar no navegador** (`npm run dev`, http://localhost:5173): topo mostra "seg, 09/11" e muda
  sozinho; pausar congela furgões e data; criar contrato para o cliente sem contrato → aparece na lista com as próximas
  datas; editar e encerrar funcionam; segundo contrato para o mesmo cliente mostra o erro.
- [ ] **Step 4: Commit** `feat(web): data da operação, pausa e tela de contratos`

### Task 9: Painel — Coletas do dia, furgões no mapa e ações da bombona

**Files:**
- Create: `web/src/paginas/Coletas.tsx`, `web/src/componentes/MapaRoteiros.tsx`
- Modify: `web/src/paginas/Mapa.tsx` (marcador de furgão por roteiro em andamento)
- Modify: `web/src/paginas/AcoesBombona.tsx` (sai "enviar para cliente" e a coleta de rotina; fica a recuperação de
  extraviada; os cenários continuam)
- Modify: `web/src/estilo.css`

**Interfaces:**
- Consumes: `useMonitoramento().roteiros`, `api.roteiros`, `api.simular(null, 'VENDA_SILENCIOSA')` (Task 8).

- [ ] **Step 1: Implement** conforme o rascunho aprovado (`coletas-do-dia.html`):
  - Cabeçalho: data, total de coletas e de furgões, botão "Venda com rastreador arrancado" (simulação; mostra qual
    bombona e cliente foram escolhidos e que o sumiço aparece na próxima coleta).
  - Cartão por furgão: cor fixa por `numero` (4 cores), "Furgão N", cidades das paradas, `paradas`, `carga/capacidade`,
    km (`distanciaM`), situação ("aguardando", "em rota · parada X de Y", "no pátio").
  - Furgão selecionado: paradas em ordem com o resultado ("trocou BO-0102 ↔ BO-0340", "deixou 2", "não encontrada:
    BO-0007 (conta no risco)", "retirada").
  - "Não atendidas", quando houver, com o motivo.
  - Mapa (`MapaRoteiros`): linha do `trajeto` na cor do furgão, pinos numerados (cinza quando `FEITA`), marcador do furgão
    na `posicao`. No `Mapa.tsx` principal, só o marcador do furgão.
- [ ] **Step 2: Run** `npm run typecheck` → sem erro.
- [ ] **Step 3: Verificar no navegador:** um dia inteiro na aba Coletas do dia (furgões andando, pinos ficando cinza,
  resultado das paradas); usar "Venda com rastreador arrancado" → nenhum alerta de cerca; no dia seguinte o furgão não
  acha a bombona, aparece `EXTRAVIO` e o risco do cliente sobe na tela Clientes. Tamanho de celular: tela usável sem
  rolagem horizontal.
- [ ] **Step 4: Commit** `feat(web): coletas do dia com furgões e rotas no mapa`

### Task 10: Documentação

**Files:**
- Modify: `docs/regras-de-negocio.md` (entidades Contrato, Roteiro/Furgão, Parada; "Contexto assumido" com a coleta
  por troca e por contrato, fonte: resposta da professora; RN19 a RN24; parâmetros novos; RN04 e RN05 citando a troca)
- Modify: `README.md` (arquitetura e roteiro de demonstração: assistir um dia, pausar, criar o contrato do cliente sem
  contrato, venda com rastreador arrancado e a parada que não acha a bombona)
- Modify: `.gitignore` (`.superpowers/`)

- [ ] **Step 1: Implement.** Deixar explícito que as vendas na demonstração são raras só para não poluir a tela.
- [ ] **Step 2: Run** `npm test` e `npm run typecheck` → passam.
- [ ] **Step 3: Commit** `docs: contratos, roteiros e RN19 a RN24`
