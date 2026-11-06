# Simulador de rastreadores

Faz o papel do hardware que ainda não existe. Cada bombona envia a própria posição pelo
[contrato público](../docs/contrato-dispositivo.md) (`POST /api/telemetria` com o token do dispositivo),
exatamente como um aparelho real faria.

Para saber onde cada bombona deveria estar e quais cenários o painel pediu, o simulador consulta o canal de
controle da demonstração (`GET /api/simulacao/estado`). Esse canal não existiria num cenário real.

Ele também dirige os **furgões**: cada roteiro em andamento faz uma única consulta ao OSRM (pátio → paradas →
pátio), envia o desenho (`POST /api/roteiros/:id/trajeto`) e a posição a cada passo, para ~1 s em cada parada e
informa a troca (`POST .../paradas/:paradaId/troca`) com as bombonas que achou no cliente e os litros, gerados em
torno do esperado do cliente. De volta ao pátio, conclui o roteiro. A rota inteira cabe em ~90 s. Se o simulador
reiniciar no meio de um roteiro, o furgão recomeça da última parada feita.

## Comportamento

| Situação                    | O que o "rastreador" faz                                      |
|-----------------------------|---------------------------------------------------------------|
| Parada (pátio/cliente)      | Fica no lugar, sem ruído, e manda sinal a cada segundo        |
| No furgão de um roteiro     | Vai junto com o furgão (mesma posição)                        |
| `EM_ROTA` sem roteiro (recuperação) | Anda sozinha pelas ruas até o pátio, como se estivesse num furgão, e continua até o ponto mesmo depois de a chegada ser confirmada na borda da cerca |
| Cenário **VENDA**           | Alguém leva a bombona pelas ruas, de 4 a 9 km, numa direção aleatória, e para numa rua |
| Cenário **VENDA COM RASTREADOR ARRANCADO** | A bombona some e o rastreador nunca mais manda leitura; o furgão não a encontra na próxima parada do cliente |
| Virada do dia simulado      | Com chance `SIM_VENDAS_POR_DIA`, uma bombona parada em cliente é "vendida" (cenário VENDA) |
| Operação pausada            | Ninguém se move (furgões, vendas, devoluções), não há sorteio nem gasto de bateria, e o silêncio do cenário SEM SINAL fica congelado; os parados continuam mandando sinal |
| Velocidade **2x**           | Cada ciclo faz o dobro (passos do furgão, da bombona e gasto de bateria); o tick continua em 250 ms |
| Reset / nova rodada         | O servidor muda o `X-Rodada` (mandado em toda escrita); o simulador descarta todo o estado e recomeça com os tokens novos |
| Cenário **DEVOLUÇÃO**       | A bombona volta pelas ruas para o local esperado              |
| Cenário **SEM SINAL**       | O rastreador fica calado até passar o limite de sem sinal (contado em tempo simulado: 2x corre dobrado, pausa congela) |
| Cenário **BATERIA FRACA**   | A bateria cai para 14%                                        |
| Coleta registrada no painel | Quem estava com a bombona "perde" ela e o furgão a leva ao pátio |
| Chegada ao pátio            | O rastreador é recarregado (bateria em 100%) e manda uma leitura na hora |

## Variáveis

| Variável              | Padrão                       | Descrição                                       |
|-----------------------|------------------------------|-------------------------------------------------|
| `API_URL`             | `http://localhost:3333/api`  | Endereço da API                                 |
| `SIM_TOKEN`           | `sim-demo-token`             | Token do canal de simulação (igual ao da API)   |
| `SIM_TICK_MS`         | `250`                        | Intervalo do ciclo (leitura em movimento)       |
| `SIM_DURACAO_ROTEIRO_S` | `90`                       | Duração alvo de um roteiro inteiro (pátio → paradas → pátio), pausas incluídas |
| `SIM_PAUSA_PARADA_MS` | `1000`                       | Pausa do furgão em cada parada antes da troca   |
| `SIM_VENDAS_POR_DIA`  | `0.4`                        | Chance de uma venda clandestina sorteada a cada dia simulado, no total (0 desliga). Na vida real elas são frequentes; a demonstração as deixa raras |
| `ROTEADOR_URL`        | `https://router.project-osrm.org` | Serviço de rotas (OSRM) usado em todas as viagens; sem resposta dele, a bombona espera e tenta de novo. O mapa usa o mesmo, via `VITE_ROTEADOR_URL` |
