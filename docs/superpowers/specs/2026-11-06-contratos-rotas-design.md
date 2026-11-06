# Contratos de coleta e rotas do dia · design

> 2026-11-06 · aguardando aprovação · fonte: resposta da professora (Priscila) sobre como a Bio Óleo
> trabalha + conversa de brainstorming com o Matheus
>
> **Base:** este design parte da branch `feat/ajustes-bio-oleo` **com o código** (seed de 25 clientes em 15
> cidades, litros na coleta RN17, coleta abaixo do esperado RN18, furgão com teto de 90 s, pátio no endereço
> real, `PRAGMA user_version`). Esse código hoje só existe no clone do PC da faculdade. **O plano só começa depois
> do push e do merge dessa branch**, e é escrito contra o código real dela, não contra o design dos ajustes.

## Intenção

Hoje o protótipo move bombonas uma a uma, por botão: "enviar para cliente" e "registrar coleta". Não é assim
que a Bio Óleo trabalha. Segundo a professora:

- **Cada cliente tem um contrato**, e o contrato define a frequência da coleta: todo dia, toda segunda, uma vez
  por mês etc.
- **A coleta é uma troca:** o coletor sai com o furgão lotado de bombonas vazias e, em cada cliente, deixa
  vazias e leva as cheias.
- Com os contratos dá para saber **quem coletar em cada dia** e montar **rotas** que passam por muitos clientes
  num dia só.

O protótipo passa a funcionar assim: o sistema tem um **calendário próprio** e os dias passam sozinhos. A cada
dia ele lê os contratos, monta a lista de coletas, divide entre os furgões e calcula a rota de cada um. Os
furgões saem do pátio e fazem a rota no mapa, trocando bombonas em cada parada.

O **problema do projeto não muda**: o sumiço de bombonas por venda clandestina. Ele acontece **entre as
coletas**, com a bombona parada no cliente, e o rastreio e os alertas continuam como estão. O que muda é o dia a
dia em volta dele, que fica fiel à operação real.

## Objetivos

1. **Contratos.** Cada cliente tem um contrato com frequência e quantidade de bombonas. Uma tela permite criar
   e editar.
2. **Calendário simulado.** Os dias passam sozinhos. Um dia dura uns **2 minutos** na demonstração.
3. **Coletas do dia.** A cada dia o sistema gera a lista de coletas a partir dos contratos.
4. **Rotas.** O sistema divide as coletas entre os furgões pela capacidade e monta a ordem das paradas.
5. **Furgão ao vivo.** Os furgões fazem as rotas no mapa, pelas ruas, trocando bombonas em cada parada.
6. **Sumiço na parada.** Se a bombona não estiver no cliente, o coletor deixa as vazias do mesmo jeito e o
   sumiço é registrado.

## Fora do escopo

- Escala real de 1.453 clientes. A demonstração tem uns 50 clientes.
- Janela de horário do cliente, trânsito, jornada do motorista, custo de combustível.
- Remarcar automaticamente uma coleta que não coube em nenhum furgão. Com a frota padrão isso não acontece no
  seed. Se acontecer, ela aparece como "não atendida" no dia (ver Regras).
- Parte financeira (continua só com os litros, como nos ajustes).
- Coleta residencial (Reciclaóleo).

## Antiobjetivos

- **A demonstração não pode ficar lenta nem confusa.** Um dia precisa caber em ~2 min, e o operador precisa
  entender o que está vendo sem explicação: data na tela, furgões com cores, paradas numeradas.
- **O rastreio de sumiço não pode ficar em segundo plano.** As rotas são o cenário; os alertas continuam sendo
  o centro.
- **Um sumiço não pode contar duas vezes no risco do cliente** (ver RN22).
- As vendas clandestinas são **frequentes na vida real**. Na demonstração elas ficam **raras**, só para não
  poluir a tela. Isso é um parâmetro de simulação, não uma afirmação sobre o negócio, e os textos não devem
  dizer o contrário.

## Como fica

### 1. Contrato

| Campo | Regra |
|---|---|
| Cliente | Um contrato **ativo** por cliente |
| Quantidade de bombonas | Inteiro ≥ 1. É quantas bombonas ficam no cliente |
| Frequência | `DIARIA`, `SEMANAL`, `QUINZENAL` ou `MENSAL` |
| Dias da semana | `SEMANAL`: um ou mais (seg a sáb). `QUINZENAL`: exatamente um |
| Dia do mês | `MENSAL`: 1 a 31 |
| Início | Data. A primeira coleta é a primeira data válida a partir dela |
| Situação | `ATIVO` ou `ENCERRADO` |

Quando cada frequência gera coleta:
- **Diária:** todo dia, de segunda a sábado.
- **Semanal:** nos dias da semana marcados.
- **Quinzenal:** no dia da semana marcado, a cada 14 dias, contando a partir da primeira ocorrência depois do
  início.
- **Mensal:** no dia do mês marcado. Se o mês não tiver esse dia (31 em novembro), a coleta cai no último dia
  do mês.
- **Domingo nunca tem coleta.** Se uma coleta mensal cair num domingo, ela passa para a segunda.

### 2. Calendário simulado

- O sistema guarda uma **data de operação** simulada, que começa numa segunda-feira (ex.: 09/11/2026).
- Ciclo de um dia, em ~2 min:
  1. **Manhã:** gera as coletas do dia, divide entre os furgões e calcula as rotas.
  2. **Rotas:** os furgões saem, fazem as paradas e voltam ao pátio. Esse é o grosso dos 2 min.
  3. **Fim do dia:** quando todos os furgões voltam, a data avança para o próximo dia com coleta (domingo é
     pulado direto).
- O dia **só avança quando todos os furgões voltaram**, para nenhuma rota ficar pela metade.
- **Pausar congela tudo:** furgões param no lugar, o relógio para e não há vendas sorteadas. Os rastreadores
  continuam mandando a última posição, para não abrir `SEM_SINAL`. *(decisão do Claude)*
- **Reinício:** a data de operação fica salva no banco. Uma rota interrompida por reinício é concluída na hora,
  sem animação: as paradas restantes são feitas como se o furgão tivesse passado. Depois o dia avança normalmente.
  *(decisão do Claude)*
- Na tela aparecem a data e o dia da semana simulados (ex.: "seg, 09/11"), e um botão de **pausar e
  continuar** o relógio para a apresentação.
- Os horários de leituras e alertas continuam sendo o relógio real. A data simulada é só a data de operação das
  coletas e das rotas.

### 3. Furgões e rotas

- **Frota:** o sistema usa quantos furgões forem necessários, até um máximo configurável (padrão 4).
  **Capacidade** por furgão: padrão **8 bombonas** na demonstração, para que saiam 2 ou 3 furgões e a divisão
  apareça.
- **Capacidade conta bombonas, não paradas.** O furgão sai com uma vazia para cada bombona que vai trocar. Uma
  parada de 3 bombonas ocupa 3. Uma parada nunca é dividida entre furgões.
- **Divisão:** por região. Os clientes do dia são agrupados por direção a partir do pátio (varredura por
  ângulo), enchendo um furgão até a capacidade antes de passar ao próximo. Assim cada furgão fica com uma região
  (Umuarama, Maringá…).
- **Ordem das paradas:** vizinho mais próximo a partir do pátio, depois melhorado com 2-opt, por distância em
  linha reta. É rápido e bom o bastante para ~10 paradas.
- **Trajeto:** uma única chamada ao OSRM por furgão, com todas as paradas na ordem (pátio → paradas → pátio).
  Ela dá o desenho pelas ruas e a distância. Sem resposta do OSRM, a regra atual vale: espera e tenta de novo.
- **Velocidade:** a rota inteira de um furgão precisa caber em ~90 s, então o passo é proporcional à distância
  total da rota (mesmo princípio dos ajustes, aplicado à rota toda). Cada parada tem uma pausa curta (~1 s) para
  a troca ficar visível.
- **Rastreio:** o furgão é uma entidade nova, com posição própria no mapa. As bombonas dentro dele são
  `EM_ROTA` e o rastreador de cada uma envia a posição do furgão, como hoje.

### 4. A parada (a troca)

No cliente, o furgão:
1. **Deixa** vazias até o cliente ficar com a quantidade do contrato. Elas passam a `EM_CLIENTE` daquele
   cliente.
2. **Leva todas** as bombonas desse cliente que estão `EM_CLIENTE` dentro da cerca. A troca é sempre completa: o
   modelo não tem nível de enchimento, e toda bombona encontrada vai embora. Elas passam a `EM_ROTA` com
   destino ao pátio. Cada uma registra a coleta **com litros** (RN17), e a RN18 continua rodando sobre esses
   litros. Os litros são gerados pelo simulador em torno da média do cliente; de vez em quando bem abaixo, para
   a RN18 aparecer.
3. Bombona do contrato que **não está lá** (`EXTRAVIADA` ou fora da cerca): ver RN22.

Ao chegar ao pátio, as cheias são esvaziadas e viram vazias disponíveis (`PATIO`), recarregadas como hoje
(RN11).

### 5. Regras novas

- **RN19 – Contrato.** Cada cliente tem no máximo um contrato `ATIVO`. Só clientes com contrato ativo entram
  nas coletas do dia.
- **RN20 – Coletas do dia.** Na manhã de cada data de operação, toda frequência que cai naquela data gera uma
  coleta (seção 1). Contrato criado ou editado vale **a partir do próximo dia**; não mexe numa rota que já
  saiu.
- **RN21 – Troca.** Na parada, o furgão deixa vazias até completar a quantidade do contrato e leva as cheias
  que encontrar no cliente (seção 4).
  - **Cliente novo** (nenhuma bombona ainda): só deixa vazias.
  - **Contrato encerrado:** o furgão passa uma última vez, leva as bombonas e não deixa vazias.
  - **Quantidade aumentada:** deixa as que faltam.
  - **Quantidade reduzida:** como toda visita leva todas, basta deixar menos vazias.
  - **Quando valem:** encerramento e mudança de quantidade valem a partir do próximo dia de operação. O
    encerramento gera uma visita de retirada nesse dia, fora da frequência. A mudança de quantidade espera a
    próxima coleta da frequência. *(decisão do Claude)*
- **RN22 – Sumiço descoberto na parada.** Se uma bombona do cliente não está lá na hora da troca:
  - o furgão deixa a vazia do mesmo jeito, e o cliente fica com a quantidade do contrato;
  - a bombona que sumiu continua `EXTRAVIADA` (ou fica, se ainda não estava), e a parada registra uma
    movimentação "não encontrada";
  - **conta incidente no risco (RN14) só se o rastreador não tinha detectado o sumiço**, ou seja, se não existe
    alerta `FORA_DA_AREA` daquela bombona aberto **desde a última vez que ela foi deixada nesse cliente**
    (movimentação de chegada mais recente). É o caso do rastreador sem sinal ou arrancado. Se o rastreador já
    tinha visto, a parada só confirma e não soma.
  - **Quem sabe a verdade:** o simulador. Ele sabe o que vendeu e informa, em cada parada, quais bombonas achou.
    O servidor não deduz isso da última posição, porque um rastreador mudo continua "dentro da cerca".
    *(decisão do Claude)*
  - **Como aparece:** movimentação `NAO_ENCONTRADA`. Quando ela conta incidente, é marcada assim, e a consulta de
    risco passa a somar os `FORA_DA_AREA` (`reaberto = 0`) e as `NAO_ENCONTRADA` marcadas. Se ainda não houver
    alerta `EXTRAVIO` aberto para a bombona, ele é aberto. *(decisão do Claude)*
  - Isso vale para cada bombona: se 2 de 3 sumiram, a regra roda para cada uma das duas.
- **RN23 – Capacidade.** Uma rota não leva mais bombonas que a capacidade do furgão. Se as coletas do dia não
  couberem na frota máxima, as que sobram ficam "não atendidas" naquele dia e aparecem na tela Coletas do dia.
  Não são remarcadas.
- **RN24 – Estoque do pátio.** Uma rota só sai com as vazias que existem no pátio. O seed garante estoque
  suficiente: a soma das quantidades dos contratos + capacidade × frota máxima.

### 6. Telas

Rascunhos aprovados na conversa (estrutura, não visual): `.superpowers/brainstorm/…/content/coletas-do-dia.html`
e `contratos.html`.

- **Coletas do dia** (aba nova): data simulada no topo, total de coletas e de furgões. Um cartão por furgão
  (cor, região, paradas, bombonas/capacidade, km, situação "aguardando / em rota parada X de Y / no pátio").
  Ao escolher um furgão, a lista de paradas na ordem, com o resultado de cada uma (trocou BO-0102 ↔ BO-0340,
  bombona não encontrada etc.). Coletas "não atendidas", se houver. Ao lado, o mapa com uma linha colorida por
  furgão, pinos numerados (cinza depois de atendidos) e o furgão andando.
- **Contratos** (aba nova): lista com cliente, frequência, quantidade e próxima coleta. O formulário de criar e
  editar tem os campos da seção 1, mostra as **próximas datas de coleta** calculadas e tem a opção de encerrar.
  Para o contrato do zero na apresentação, a tela de contratos precisa permitir **criar o cliente junto** ou
  escolher um cliente sem contrato.
- **Mapa** (existente): continua sendo a tela do rastreio. Ganha os furgões em movimento e a data simulada.
- **Botões manuais:** "enviar para cliente" e "registrar coleta" de rotina saem do painel da bombona, porque
  quem move as bombonas agora é a rota. Fica a **recuperação** de bombona extraviada.
- **Simulação:** continua existindo um botão para **forçar uma venda clandestina**, já que na demonstração
  elas são raras.
- **Venda com rastreador arrancado** (botão novo de simulação, pedido pelo Matheus): a bombona some e o
  rastreador para de mandar leituras, sem sair da cerca. Nenhum alerta de cerca abre; só o `SEM_SINAL` depois do
  tempo dele. Na próxima coleta daquele cliente, o furgão não acha a bombona e a RN22 conta o incidente. Para
  a demonstração não esperar dias, o botão deve preferir uma bombona de cliente com coleta no **próximo dia**.

### 7. Seed

- **50 clientes** (os 25 dos ajustes + 25 novos, nas mesmas regiões), **49 com contrato** ativo e 1 sem, para
  criar o contrato ao vivo.
- Mistura de frequências pensada para os dias da demonstração ficarem diferentes entre si. Ordem de grandeza:
  ~5 diários, ~15 semanais (alguns com mais de um dia), ~8 quinzenais e ~21 mensais. Alguns clientes com 2 ou 3
  bombonas.
- Calibrar para cada dia ter entre ~15 e ~25 coletas e 2 a 3 furgões com capacidade 8. O 1º dia (segunda
  09/11) precisa ter mensais do dia 9, para a mistura aparecer logo.
- Bombonas no seed: as dos contratos já nos clientes, mais o estoque do pátio (RN24). O histórico de litros dos
  ajustes continua valendo para a RN18.

### 8. Parâmetros novos

| Parâmetro | Demonstração |
|---|---|
| Capacidade do furgão | 8 bombonas |
| Frota máxima | 4 furgões |
| Duração alvo da rota | 90 s |
| Pausa na parada | 1 s |
| Data inicial da operação | seg 09/11/2026 |
| Vendas clandestinas sorteadas | ~1 a cada 2 ou 3 dias simulados (no total, não por bombona) |

## Restrições

- Node 23.6+, SQLite embutido, **sem dependência nova** (roteirização feita à mão: varredura + vizinho mais
  próximo + 2-opt).
- OSRM público: **uma chamada por furgão por dia**, nada de chamada por trecho.
- Banco: tabelas novas (contratos, furgões, rotas, paradas) e valores novos em `movimentacoes.tipo`. Sobe o
  `PRAGMA user_version`, e o banco antigo se recria sozinho.
- Testes atuais continuam passando, ajustados onde as ações manuais saírem. Testes novos no mínimo:
  - geração das coletas por frequência (incluindo dia 31, domingo e quinzenal);
  - divisão respeitando a capacidade e parada não dividida;
  - troca normal, cliente novo, contrato encerrado e quantidade mudada;
  - RN22 contando e não contando incidente;
  - estoque e coletas não atendidas.
- Docs: `docs/regras-de-negocio.md` ganha as RN19 a RN24, a entidade Contrato/Furgão/Rota e a descrição da
  troca. O README atualiza o roteiro de demonstração.

## Fica para quem implementar

- Nomes de tabelas, rotas da API e componentes.
- Algoritmo exato da varredura (onde começar o ângulo, desempate) e se vale o 2-opt.
- Cores dos furgões, ícone do furgão e textos finais.
- Como o simulador e o servidor dividem o trabalho do calendário (quem é o dono do relógio), desde que o painel
  mostre a data e o botão de pausar funcione.
