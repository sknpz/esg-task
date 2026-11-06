# Regras de negócio (hipotéticas)

> Os **parâmetros** e as regras abaixo **não** vieram da Bio Óleo: foram criados para o protótipo, a partir do
> problema descrito (bombonas que somem porque o cliente vende, de propósito ou não). Os números (raios,
> tempos, limites) são configuráveis e devem ser revistos com a empresa antes de qualquer uso real. Só o
> contexto da operação, em "Contexto assumido", vem de dados reais.

## Contexto assumido

A Bio Óleo deixa bombonas nos clientes (restaurantes, pastelarias, lanchonetes, indústrias de alimentos)
para armazenar óleo de cozinha usado. Periodicamente um furgão passa, recolhe a bombona cheia e deixa
uma vazia. O óleo vira matéria-prima para biodiesel, o que é um ganho ambiental (logística reversa).

Dados reais, da apresentação da Bio Óleo em aula (Aula 07): 1.453 pontos atendidos, em mais de 70 municípios
do PR, num raio de 250 km de Cianorte; os veículos são furgões e já são rastreados em tempo real; cada coleta
é paga pelos litros coletados; as bombonas têm lacre com trava. O pátio do protótipo fica no local real da
empresa (endereço público); clientes e endereços do seed são fictícios.

**Como a coleta funciona** (fonte: resposta da professora sobre a operação da Bio Óleo):

- **Coleta por contrato.** Cada cliente tem um contrato que define a frequência da coleta: todo dia, toda
  segunda, uma vez por mês etc. Com os contratos dá para saber quem coletar em cada dia.
- **Coleta por troca.** O coletor sai com o furgão carregado de bombonas vazias e, em cada cliente, deixa vazias e
  leva as cheias. Com os contratos do dia, montam-se rotas que passam por muitos clientes de uma vez.

O protótipo imita isso com um calendário próprio (os dias simulados passam sozinhos) e furgões que fazem as
rotas no mapa. Os números do contrato, da frota e do calendário são hipóteses, como o resto.

O prejuízo acontece quando a bombona não está no cliente na hora da coleta: foi vendida a um sucateiro,
emprestada, levada por outra empresa de coleta ou simplesmente descartada.

## Entidades

| Entidade     | Descrição                                                                                 |
|--------------|-------------------------------------------------------------------------------------------|
| Cliente      | Estabelecimento que recebe bombonas. Tem endereço, coordenada e uma **cerca virtual** (raio). |
| Bombona      | Recipiente com código único (`BO-0001`), capacidade e um dispositivo rastreador vinculado. |
| Dispositivo  | Rastreador preso à bombona. Hardware indefinido: só precisa cumprir o [contrato](contrato-dispositivo.md). |
| Leitura      | Posição e bateria enviadas pelo dispositivo.                                              |
| Movimentação | Registro operacional: saída para entrega, coleta, chegada.                                |
| Alerta       | Ocorrência gerada pelas regras abaixo.                                                    |
| Contrato     | Combinado com o cliente: quantas bombonas ficam lá e a frequência da coleta (`DIARIA`, `SEMANAL`, `QUINZENAL` ou `MENSAL`, com dias da semana ou dia do mês e uma data de início). `ATIVO` ou `ENCERRADO`. |
| Roteiro (furgão) | Um furgão num dia de operação: capacidade em bombonas, as paradas na ordem, o trajeto pelas ruas, a posição ao vivo e a situação (`PLANEJADO`, `EM_ANDAMENTO`, `CONCLUIDO`). |
| Parada       | Uma visita a um cliente dentro do roteiro: motivo (`COLETA` pelo contrato ou `RETIRADA` no encerramento), quantas vazias deixar, a demanda em bombonas e o resultado da troca (deixadas, levadas com litros, não encontradas). Fica `NAO_ATENDIDA` se não coube na frota ou faltaram vazias. |

## Status da bombona

| Status       | Significado                                         | Local esperado               |
|--------------|-----------------------------------------------------|------------------------------|
| `PATIO`      | Na base da Bio Óleo                                 | Cerca do pátio               |
| `EM_ROTA`    | No furgão (indo para um cliente ou voltando ao pátio) | Nenhum (sem cerca)       |
| `EM_CLIENTE` | Alocada a um cliente                                | Cerca do cliente             |
| `EXTRAVIADA` | Longe demais do local esperado                      | Cerca do cliente de origem   |

## Regras

- **RN01 – Vínculo único.** Cada bombona tem exatamente um dispositivo, e cada dispositivo pertence a uma bombona.
- **RN02 – Cerca virtual.** Cada cliente tem um raio permitido (padrão 150 m). O pátio da Bio Óleo também tem
  uma cerca (padrão 250 m).
- **RN03 – Saída para entrega.** Ao registrar a saída de uma bombona do pátio para um cliente, ela passa a
  `EM_ROTA` com aquele cliente como destino. Só é possível enviar bombonas que estão no `PATIO`. No dia a dia
  quem faz isso é o roteiro: ao sair, o furgão carrega as vazias do pátio (RN24).
- **RN04 – Entrega confirmada pela chegada.** Quando uma bombona `EM_ROTA` envia uma leitura dentro da cerca do
  destino, ela passa a `EM_CLIENTE` (ou `PATIO`) automaticamente e é registrada uma movimentação de chegada.
  É o equivalente ao "pedido entregue" do iFood. Bombonas dentro de um furgão só mudam de status pela **troca**
  na parada (RN21): passar perto da cerca de um cliente não as entrega.
- **RN05 – Coleta.** Ao registrar a coleta, a bombona passa a `EM_ROTA` com destino ao pátio. Só é possível
  coletar bombonas `EM_CLIENTE` ou `EXTRAVIADA` (recuperação). No dia a dia a coleta acontece pela **troca** na
  parada do roteiro (RN21); o registro manual (API) fica para a recuperação. Uma bombona dentro do furgão só sai
  dele pela troca ou ao voltar ao pátio.
- **RN06 – Tolerância de GPS.** Uma leitura só conta como "fora da cerca" se a distância até o centro for maior
  que `raio + precisão informada pelo dispositivo`.
- **RN07 – Confirmação em duas leituras.** O alerta `FORA_DA_AREA` só é aberto depois de **2 leituras
  consecutivas** fora da cerca, para evitar alarme falso por um salto de GPS.
- **RN08 – Extravio.** Se a bombona fora da cerca estiver a mais de **2 km** do local esperado, ela passa a
  `EXTRAVIADA` e é aberto um alerta `EXTRAVIO` crítico.
- **RN09 – Retorno.** Se uma bombona fora da área voltar para dentro da cerca, os alertas `FORA_DA_AREA` e
  `EXTRAVIO` são resolvidos automaticamente e o status volta ao anterior.
- **RN10 – Sem sinal.** Se um dispositivo não envia leitura há mais de **6 h** (na demonstração: 45 s), é
  aberto o alerta `SEM_SINAL`. Esse alerta se resolve sozinho quando o sinal volta.
- **RN11 – Bateria baixa.** Uma leitura com bateria abaixo de **20%** abre o alerta `BATERIA_BAIXA`. Ele se
  resolve sozinho quando a bateria passa de 30%, depois da troca ou recarga. O rastreador é recarregado sempre
  que a bombona volta ao pátio.
- **RN12 – Um alerta aberto por tipo.** Uma bombona não pode ter dois alertas abertos do mesmo tipo (exceto `COLETA_ABAIXO`, que é por cliente: RN18).
- **RN13 – Bombona em rota não gera alerta de cerca.** Durante o transporte não existe local esperado.
- **RN14 – Risco do cliente.** O cliente acumula um histórico de incidentes, que é a quantidade de alertas
  `FORA_DA_AREA` ligados a ele. Cada saída da cerca conta uma vez, mesmo que depois vire extravio.
  Classificação: 0 = baixo, 1–2 = médio, 3 ou mais = alto. Serve para a área comercial decidir se mantém o
  cliente ou cobra caução.
- **RN15 – Resolução manual.** O operador pode resolver qualquer alerta aberto, informando uma observação
  (ex.: "cliente devolveu, bombona estava no depósito dos fundos"). Se a bombona continuar fora da cerca, o
  alerta reabre na próxima confirmação: resolver não esconde um problema que ainda existe. Na coleta de uma
  bombona extraviada (recuperação), os alertas de cerca são resolvidos junto.
- **RN16 – Autenticação do dispositivo.** Leituras só são aceitas com o token do dispositivo. Se o token for
  desconhecido, a resposta é `401`. Se a coordenada ou a bateria forem inválidas, a resposta é `400`.
- **RN17 – Litros na coleta.** A coleta normal (bombona `EM_CLIENTE`) exige `litros`: inteiro entre 0 e a
  capacidade da bombona (fora disso, `400`). Na recuperação (`EXTRAVIADA`) o campo é ignorado, porque o óleo
  de uma bombona extraviada não representa o cliente. Os litros ficam na movimentação `COLETA`.
- **RN18 – Coleta abaixo do esperado.** O esperado é a média de litros das últimas `COLETA_HISTORICO_N` (3)
  coletas normais anteriores do cliente; com menos coletas, a regra não roda. Se `litros` ficar abaixo de
  esperado × `COLETA_MINIMO_PCT` (50) %, abre o alerta `COLETA_ABAIXO` (severidade `AVISO`), por exemplo
  "Coleta de 20 L, esperado ~50 L". É só um aviso: não conta no risco do cliente (RN14), não muda o status da
  bombona e só se resolve manualmente (RN15). Um mês fraco não é fraude. O aviso é do cliente, não da bombona:
  há no máximo um aberto por cliente, e uma nova coleta baixa no mesmo cliente (de qualquer bombona) substitui o
  aviso aberto (resolvido pelo sistema). Ele aparece na tela Alertas, mas não conta como alerta da bombona nem
  aparece como alerta no mapa.
- **RN19 – Contrato.** Cada cliente tem no máximo um contrato `ATIVO` (criar outro dá `409`). A quantidade é um
  inteiro maior ou igual a 1 e a frequência é validada: `SEMANAL` exige um ou mais dias (segunda a sábado),
  `QUINZENAL` exatamente um dia da semana (a cada 14 dias, contando da primeira ocorrência depois do início),
  `MENSAL` um dia do mês de 1 a 31 (mês sem esse dia cai no último dia; coleta que cai num domingo passa para a
  segunda). **Domingo nunca tem coleta.** Contrato encerrado não pode mais ser alterado (`409`).
- **RN20 – Coletas do dia.** O servidor é dono do relógio e cada dia simulado tem três fases: **manhã** (as
  coletas do dia são geradas dos contratos e divididas entre os furgões; depois de `FASE_PAUSA_S` os furgões
  saem), **rotas** (os furgões fazem as paradas) e **fim do dia** (só depois de todos os furgões voltarem, e
  depois da mesma pausa, a data avança para o próximo dia de operação, pulando o domingo). O planejamento
  acontece uma vez por data: contrato criado ou editado vale a partir do próximo dia e não mexe numa rota que já
  saiu. Contrato encerrado gera **uma** parada de retirada (fora da frequência, sem deixar vazias), a menos que o
  cliente já tenha um novo contrato `ATIVO` (a próxima coleta dele troca tudo) ou não haja bombona dele para
  buscar; se a retirada coincide com um dia de coleta, vira uma parada só. Pausar congela o relógio, os furgões e
  as vendas sorteadas, e os rastreadores seguem mandando a última posição (para não abrir `SEM_SINAL`). Se o
  servidor reiniciar com um furgão na rua, as paradas restantes são feitas como se ele tivesse passado e o
  roteiro é concluído.
- **RN21 – Troca.** Na parada, o furgão **leva todas** as bombonas do cliente que estão `EM_CLIENTE`: o modelo não
  tem nível de enchimento, então a troca é sempre completa. Cada uma registra a coleta com litros (RN17; a RN18
  continua valendo, e a 2ª bombona da mesma troca já inclui os litros da 1ª) e vai a `EM_ROTA` para o pátio.
  Depois **deixa** as vazias que trouxe, que viram `EM_CLIENTE` do cliente com uma movimentação de entrega.
  Cliente novo (sem bombona) só recebe vazias. Aumentar a quantidade do contrato faz o furgão deixar mais vazias
  na próxima coleta; reduzir, menos. Ao voltar ao pátio, as cheias são descarregadas e viram vazias (`PATIO`,
  recarregadas, RN11); as vazias que sobraram também voltam ao estoque. Os litros são gerados pelo simulador em
  torno da média do cliente, de vez em quando bem abaixo.
- **RN22 – Sumiço descoberto na parada.** O simulador, que conhece a verdade física, informa quais bombonas
  achou; o servidor não deduz isso da última posição, porque um rastreador mudo continua "dentro da cerca". Para
  cada bombona do cliente que não foi achada (`EM_CLIENTE` que não estava lá, ou `EXTRAVIADA`): o furgão deixa
  as vazias do mesmo jeito (o cliente fica com a quantidade do contrato), registra a movimentação
  `NAO_ENCONTRADA`, marca a bombona `EXTRAVIADA` e abre o alerta `EXTRAVIO` se ainda não houver um. **Conta um
  incidente no risco do cliente (RN14) só se o rastreador não tinha visto o sumiço**, isto é, se não existe
  alerta `FORA_DA_AREA` da bombona aberto desde a última vez que ela foi deixada ali. Se o rastreador já tinha
  detectado, a parada só confirma, sem somar de novo: um sumiço não conta duas vezes. Uma bombona já registrada
  como não encontrada deixa de ser procurada nas visitas seguintes (não gera nova `NAO_ENCONTRADA` nem reabre o
  extravio), até que volte à cerca (RN09) ou seja recuperada à mão; se sumir de novo, é um sumiço novo. A regra
  roda por bombona: se 2 de 3 sumiram, roda duas vezes.
- **RN23 – Capacidade.** Um roteiro não leva mais bombonas que `FURGAO_CAPACIDADE`; a capacidade conta bombonas,
  não paradas, e uma parada nunca é dividida entre furgões. O sistema usa quantos furgões forem necessários, até
  `FROTA_MAXIMA`. A divisão é por região (varredura angular a partir do pátio, enchendo um furgão antes de passar
  ao próximo) e as paradas de cada furgão são ordenadas por vizinho mais próximo seguido de 2-opt, em linha reta.
  O que não couber na frota, ou que sozinho exceda a capacidade, fica **não atendido** naquele dia, aparece na
  tela Coletas do dia e **não é remarcado**.
- **RN24 – Estoque do pátio.** Um roteiro só sai com as vazias que existem no pátio. Se faltar vazia para uma
  parada, ela fica não atendida ("sem bombonas vazias no pátio") e o furgão sai sem ela; roteiro sem nenhuma
  parada atendível não sai. O seed garante estoque: a soma das quantidades dos contratos mais a capacidade vezes
  a frota máxima.

> **Vendas clandestinas na vida real e na demonstração.** Na vida real elas são **frequentes**: é justamente o
> problema que o sistema existe para tratar. Na demonstração o simulador as sorteia **raramente** (parâmetro
> `SIM_VENDAS_POR_DIA`) só para não poluir a tela e o operador conseguir acompanhar cada uma; isso é um parâmetro
> de simulação, não uma afirmação sobre o negócio. Os botões de simulação forçam uma venda a qualquer momento.

## Parâmetros

| Parâmetro               | Padrão (produção) | Demonstração | Variável de ambiente         |
|-------------------------|-------------------|--------------|------------------------------|
| Raio padrão do cliente  | 150 m             | 150 m        | cadastro do cliente          |
| Raio do pátio           | 250 m             | 250 m        | `PATIO_RAIO_M`               |
| Distância de extravio   | 2000 m            | 2000 m       | `EXTRAVIO_METROS`            |
| Tempo sem sinal         | 21600 s (6 h)     | 45 s         | `SEM_SINAL_SEGUNDOS`         |
| Bateria baixa           | 20%               | 20%          | `BATERIA_MINIMA`             |
| Coletas no histórico    | 3                 | 3            | `COLETA_HISTORICO_N`         |
| Mínimo da coleta        | 50% da média      | 50%          | `COLETA_MINIMO_PCT`          |
| Capacidade do furgão    | 8 bombonas        | 8            | `FURGAO_CAPACIDADE`          |
| Frota máxima            | 4 furgões         | 4            | `FROTA_MAXIMA`               |
| Data inicial da operação | segunda 2026-11-09 | 2026-11-09  | `DATA_INICIAL_OPERACAO`      |
| Pausa entre as fases do dia | 5 s           | 5 s          | `FASE_PAUSA_S`               |

Parâmetros do simulador (também no [README do simulador](../simulator/README.md)):

| Parâmetro                       | Padrão  | Variável de ambiente    |
|---------------------------------|---------|-------------------------|
| Duração alvo de um roteiro      | 90 s    | `SIM_DURACAO_ROTEIRO_S` |
| Pausa do furgão em cada parada  | 1000 ms | `SIM_PAUSA_PARADA_MS`   |
| Chance de venda por dia simulado (no total, não por bombona) | 0,4 | `SIM_VENDAS_POR_DIA` |

A capacidade e a frota pequenas, e as vendas raras, são escolhas da demonstração (divisão em 2 ou 3 furgões à
vista, tela limpa), não números da operação.
