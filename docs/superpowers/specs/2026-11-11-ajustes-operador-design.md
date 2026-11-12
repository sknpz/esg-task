# Ajustes do operador (busca de clientes, tempo real, contrato com cliente novo, acompanhar furgão) · design

Data: 2026-11-11 · Branch: `feat/contratos-rotas` · Decisões: dono do projeto · Redação: Claude

## Intenção

Cinco mudanças pedidas juntas, independentes entre si, para o protótipo ficar mais próximo do uso real e mais
cômodo de operar:

1. **Pesquisa e filtros em Clientes:** achar um cliente pelo nome/cidade/endereço e recortar a lista por risco,
   modalidade do contrato, e ordenar pela quantidade de bombonas (só ordenar, sem filtro por faixa).
2. **Furgões a 80 km/h de verdade** como padrão, com um botão para voltar ao modo de hoje (cada roteiro em ~90 s),
   que continua sendo o modo de apresentação.
3. **Contrato novo puxando o dia:** o dia da semana (ou do mês) já vem marcado a partir da data de início.
4. **Acompanhar um furgão:** em Coletas, o mapa chega perto do furgão e vai atrás dele enquanto anda.
5. **Cliente novo digitado no "Novo contrato":** hoje só dá para fazer contrato com cliente já cadastrado; o operador
   quer cadastrar o cliente (nome livre) ali mesmo, marcando o local num mapa.

## Objetivos

- O1. Tela Clientes com caixa de pesquisa, filtros de risco e de modalidade, e ordenação por bombonas.
- O2. Modo de velocidade da operação: **Tempo real** (padrão, 80 km/h) e **Demonstração** (~90 s por roteiro), com
  botão no player.
- O3. Formulário de contrato preenche o dia a partir do Início ao escolher a frequência ou mudar a data.
- O4. Botão "Acompanhar" em cada furgão de Coletas.
- O5. "Novo contrato" cria cliente + contrato de uma vez, com o local marcado por clique num mapa.

## Não objetivos

- Editar ou apagar clientes já cadastrados; mudar o raio da cerca pelo formulário.
- Buscar o endereço pela internet (geocodificação): o local é sempre marcado por clique.
- Mudar a duração da parada em cada cliente (continua ~1 s nos dois modos) ou as pausas de Manhã/Fim do dia.
- Mudar a velocidade das bombonas que andam sozinhas (venda, devolução, recuperação): o modo vale só para os
  furgões de roteiro.
- Acompanhar furgão na tela Mapa (lá aparecem bombonas, não furgões).
- Filtrar no servidor.

## Anti-objetivos (falha mesmo que "funcione")

- Em tempo real, bombonas abrindo alerta de bateria fraca sozinhas ao longo do dia.
- Trocar o modo no meio de um roteiro faz o furgão recomeçar, pular ou consultar o OSRM de novo.
- Um contrato recusado (ex.: sem dia marcado) deixa um cliente órfão criado.
- O acompanhamento puxa o mapa de volta enquanto o operador está arrastando para olhar em volta.
- O dia preenchido automaticamente impede o operador de marcar/desmarcar dias à mão depois.

## Restrições

- Node 23.6+, TypeScript direto, SQLite embutido (`node:sqlite`), React + react-leaflet no painel.
- O esquema é recriado quando `VERSAO_ESQUEMA` sobe (`server/src/db.ts`): mudar a tabela `operacao` exige subir para
  **5**; não há migração (os dados são de demonstração).
- O simulador só fala com o servidor por HTTP: tudo que ele precisa saber (pausa, velocidade, rodada e agora o modo)
  vem de `GET /api/simulacao/estado`.
- Domingo nunca tem coleta (`validarRegra` aceita dias 1..6).

## Abordagens consideradas

### Onde fica o modo tempo real / demonstração (item 2)

- **A. No servidor, junto com 1x/2x (escolhida).** Coluna `modo` na `operacao`, rota no estilo de
  `/operacao/velocidade`, evento `operacao`, e o simulador lê o modo pelo estado da simulação a cada ciclo. Mantém o
  servidor como dono do relógio e dá o botão no player.
- **B. Só no simulador, por variável de ambiente.** Mais simples, mas sem botão no painel. Descartada.

### Como criar o cliente novo junto com o contrato (item 5)

- **A. Uma chamada só (escolhida).** `POST /api/contratos` aceita `clienteId` **ou** `novoCliente`; o servidor grava
  os dois numa transação. Se o contrato for recusado, nada é gravado.
- **B. Duas chamadas (`POST /clientes` e depois `POST /contratos`).** Reaproveitável, mas uma falha na segunda deixa
  um cliente sem contrato. Descartada.

Os itens 1, 3 e 4 têm um caminho só: filtro no navegador (a lista de clientes já está toda em memória e atualiza ao
vivo), preenchimento no próprio formulário, e recentralizar o mapa de Coletas a cada posição do furgão seguido.

## Design

### Item 1 · Pesquisa e filtros em Clientes

**Servidor.** `listarClientes` (`server/src/consultas.ts`) passa a devolver também
`modalidade: Frequencia | null`, a frequência do contrato ativo (null sem contrato ativo). `contratoAtivo` continua.
Tipo `Cliente` em `web/src/api.ts` ganha o campo.

**Painel** (`web/src/paginas/Clientes.tsx`), acima da tabela:

- **Pesquisa:** caixa de texto que casa com nome, cidade e endereço, sem diferenciar acentos e maiúsculas
  (normalizar com `normalize('NFD')` e remover diacríticos).
- **Risco:** botões liga/desliga Alto, Médio, Baixo (vários ao mesmo tempo; nenhum ligado = todos).
- **Modalidade:** botões liga/desliga Diária, Semanal, Quinzenal, Mensal e Sem contrato (mesma regra).
- **Ordenar por bombonas:** clique no cabeçalho "Bombonas" alterna **decrescente → crescente → ordem original**, com
  seta indicando o estado. A ordem original é a do servidor (incidentes desc, nome).
- Os filtros se somam (E entre grupos, OU dentro de um grupo). Contador "X de Y clientes" e mensagem
  "Nenhum cliente com esses filtros" quando vazio.
- O resumo por risco no cabeçalho continua contando todos os clientes (não o recorte).
- Estado dos filtros só em memória (sem URL, sem localStorage).

A lógica de filtrar/ordenar fica numa função pura (ex.: `web/src/filtroClientes.ts`) testada em `web/test/`.

### Item 2 · Tempo real (80 km/h) e modo demonstração

**Servidor.**
- `operacao` ganha `modo TEXT NOT NULL DEFAULT 'REAL' CHECK (modo IN ('REAL', 'DEMO'))`; `VERSAO_ESQUEMA` = 5.
- `criarOperacao` grava `'REAL'` (o reset volta ao tempo real).
- `EstadoOperacao` ganha `modo: 'REAL' | 'DEMO'`.
- `POST /api/operacao/modo` com `{ modo }` (400 se inválido), função `definirModo` em `operacao.ts` que grava e emite o
  evento `operacao`. O modo não mexe em `fase_desde` (as fases Manhã/Fim não dependem dele).
- `GET /api/simulacao/estado` inclui `modo` em `operacao`.

**Simulador** (`simulator/src/furgoes.ts`, `index.ts`).
- Velocidade real configurável: `SIM_VELOCIDADE_REAL_KMH` (padrão **80**). Passo real por tick =
  `kmh / 3.6 * tickMs / 1000` metros (80 km/h a 250 ms ≈ 5,56 m).
- Ao planejar o roteiro, o furgão guarda os **dois** passos: o real e o de demonstração (o cálculo de hoje,
  `passoDoRoteiro`). A cada tick usa o do modo atual, vezes a velocidade 1x/2x. Trocar o modo no meio da rota só muda
  o ritmo dali em diante; não replaneja nem consulta o OSRM.
- `ciclo(...)` recebe o modo junto com `pausado` e `velocidade`.
- A pausa na parada (`SIM_PAUSA_PARADA_MS`) e os passos das bombonas que andam sozinhas não mudam.
- **Bateria em tempo real gasta como um rastreador de verdade** (decisão do dono do projeto): hoje o gasto é por ms de
  relógio (~1%/min andando, ~0,2%/min parada), calibrado para a demonstração. No modo `REAL`, `consumoDeBateria`
  (`simulator/src/relogio.ts`) divide o gasto por **60**: ~1%/h andando e ~0,2%/h parada (um roteiro de 1h30 gasta
  ~1,5%, como um roteiro de demonstração; parada no cliente, dura umas 3 semanas). Assim bateria fraca só aparece pelo
  cenário BATERIA FRACA. No modo `DEMO` o gasto é o de hoje; 2x continua dobrando nos dois modos. O fator fica numa
  constante no `relogio.ts`.
- Log de partida mostra os dois ritmos (ex.: "80 km/h em tempo real; ~90 s em demonstração").

**Painel** (`web/src/componentes/Player.tsx`, `api.ts`).
- Botão novo no player, ao lado do 1x/2x, que alterna e mostra o modo atual: **"Tempo real"** / **"Demo 90 s"**, com
  `title` explicando ("Furgões a 80 km/h" / "Cada roteiro em ~90 s"). Mesmo padrão de `executar(...)` e
  desabilitado enquanto ocupado.
- `api.modo(modo)`; tipo `Operacao` ganha `modo`.

**Consequência a deixar clara no README:** em tempo real um roteiro de 120 km leva ~1h30 e o dia simulado só vira
quando todos os furgões voltam. O roteiro de demonstração do README passa a mandar trocar para "Demo 90 s" antes de
apresentar.

### Item 3 · Contrato puxando o dia

Só no formulário (`web/src/paginas/Contratos.tsx`). Função pura `diaDoInicio(inicio)` →
`{ diaSemana: 1..6, diaMes: 1..31 }`, com **domingo virando segunda** (1). Testada em `web/test/`.

- Abrir "Novo contrato": Início = data simulada (como hoje); frequência inicial Semanal com o dia do Início já marcado.
- **Escolher a frequência:** Semanal ou Quinzenal → `diasSemana = [diaSemana]`; Mensal → `diaMes = diaMes do Início`;
  Diária → nada a preencher.
- **Mudar o Início:** reaplica a mesma regra para a frequência atual.
- Depois disso o operador marca/desmarca dias à mão normalmente (a regra só age nesses dois momentos).
- Na edição de um contrato existente, abrir o formulário não muda nada; a regra só age se o operador mudar a
  frequência ou o Início.
- Início vazio (data inválida): não preenche.

### Item 4 · Acompanhar um furgão

Em `web/src/paginas/Coletas.tsx` e `web/src/componentes/MapaRoteiros.tsx`.

- Cada cartão de furgão **em andamento** ganha o botão **"Acompanhar"** (fora do botão do cartão, para não aninhar
  botões). Planejado ainda no pátio ou concluído: sem botão.
- Apertar: seleciona o furgão (rota destacada e lista de paradas, como o clique no cartão) e liga o acompanhamento. O
  mapa vai para o furgão com zoom de rua (**15**) e, a cada nova `posicao` do roteiro, faz `panTo` nele. O botão
  vira **"Parar de acompanhar"**.
- **Arrastar o mapa** (`dragstart`) desliga o acompanhamento (o botão volta a "Acompanhar"). Zoom pela roda ou pelos
  botões não desliga.
- Desligar pelo botão mantém o furgão selecionado e enquadra a rota dele (o `Enquadrar` de hoje para a seleção).
  *Decisão do redator.*
- Desmarcar o furgão no cartão, trocar de dia, resetar ou o roteiro concluir: o acompanhamento desliga e o mapa
  fica onde está.
- Só um furgão acompanhado por vez; acompanhar outro troca o alvo.
- O `Enquadrar` atual não pode brigar com o acompanhamento: enquanto acompanha, ele não reenquadra.

### Item 5 · Cliente novo no "Novo contrato"

**Servidor** (`server/src/contratos.ts`).
- `criarContrato` aceita `clienteId` **ou** `novoCliente: { nome, tipo, cidade, endereco, lat, lng }` (os dois
  juntos ou nenhum → 400).
- Validação de `novoCliente`: `nome`, `tipo`, `cidade` e `endereco` são textos não vazios depois de `trim` (nome até
  120 caracteres); `lat` e `lng` números finitos e o ponto a **no máximo 250 km do pátio** (o raio de atuação da
  Bio Óleo; também evita pino sem rota pelas ruas, que faria o simulador tentar o OSRM para sempre e travar o dia).
  Constante `RAIO_ATUACAO_KM = 250` no servidor. Erros em português no padrão atual (`ErroDeNegocio(400, ...)`).
  *Raio: decisão do redator.*
- Validar a regra do contrato **antes** de gravar; depois, numa `transacao`, inserir o cliente (raio padrão da
  tabela, 150 m) e o contrato. Qualquer falha desfaz os dois.
- Sem checagem de nome repetido.
- Sem evento novo: a aba que criou chama `recarregar()` (como hoje); as outras abas recebem a lista nova na próxima
  recarga de clientes, que `web/src/monitoramento.tsx` já faz a cada evento `bombona`/`alerta` (cerca de 1 s com o
  simulador rodando). Aceito como suficiente.

**Painel** (`web/src/paginas/Contratos.tsx`, componente novo de mapa para marcar o ponto).
- O botão "Novo contrato" fica sempre habilitado (hoje fica desligado sem clientes sem contrato).
- O formulário abre no modo **cliente novo**: campos Nome (livre), Tipo (lista com os tipos distintos dos clientes
  já cadastrados, tirados de `clientes`), Cidade, Endereço e um **mapa pequeno**.
- Mapa: centrado no pátio (`config.patio`), zoom de cidade; clique coloca o pino com o círculo de 150 m; clique de
  novo move o pino. Mostra o pátio como referência. Clique a mais de 250 km do pátio não coloca o pino e mostra o
  aviso "Fora da área de atuação (250 km do pátio)".
- Salvar sem ponto marcado ou com campo vazio: mensagem de erro no formulário (validação também no servidor).
- Link **"usar cliente já cadastrado"**, visível só quando há clientes sem contrato ativo: troca para o `<select>` de
  hoje. Um link de volta "cadastrar cliente novo".
- Edição de contrato existente não muda (cliente fixo, sem mapa).
- Depois de salvar: o formulário passa para a edição do contrato criado (como hoje) e `recarregar()` atualiza clientes.

## Testes

- Servidor: `definirModo` / `POST /operacao/modo` (grava, emite evento, 400 em valor inválido, reset volta a REAL);
  `estado` da simulação traz `modo`; `criarContrato` com `novoCliente` (cria os dois; recusa sem ponto, sem nome,
  com `clienteId` e `novoCliente` juntos; regra inválida não deixa cliente gravado); `listarClientes` traz
  `modalidade`.
- Simulador: gasto de bateria em `REAL` é 1/60 do de `DEMO` (e 2x dobra nos dois); passo real de 80 km/h a 250 ms; o furgão usa o passo do modo atual e a troca no meio da rota não volta a
  posição.
- Painel: `filtroClientes` (pesquisa sem acento, combinação de filtros, ordenação) e `diaDoInicio` (domingo → segunda,
  dia do mês).

## Documentação

Atualizar `README.md` (player com o botão de modo, telas Clientes/Contratos/Coletas, roteiro de demonstração),
`simulator/README.md` (modo, `SIM_VELOCIDADE_REAL_KMH`) e `docs/regras-de-negocio.md` onde fala da duração dos
roteiros e do cadastro de contratos.

## Deixado para o construtor

- Nomes exatos de componentes, classes CSS e funções auxiliares.
- Visual dos botões de filtro e do botão de modo, seguindo `web/src/estilo.css`.
- Como `MapaRoteiros` recebe o furgão acompanhado (prop nova ou extensão de `selecionado`).
