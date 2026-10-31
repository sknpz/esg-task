# Simulador de rastreadores

Faz o papel do hardware que ainda não existe. Cada bombona envia a própria posição pelo
[contrato público](../docs/contrato-dispositivo.md) (`POST /api/telemetria` com o token do dispositivo),
exatamente como um aparelho real faria.

Para saber onde cada bombona deveria estar e quais cenários o painel pediu, o simulador consulta o canal de
controle da demonstração (`GET /api/simulacao/estado`). Esse canal não existiria num cenário real.

## Comportamento

| Situação                    | O que o "rastreador" faz                                      |
|-----------------------------|---------------------------------------------------------------|
| Parada (pátio/cliente)      | Fica no lugar, com ruído de GPS, e manda sinal a cada 5 ciclos |
| `EM_ROTA`                   | Anda até o destino pelas ruas, como se estivesse no caminhão (rota do OSRM; sem resposta dele, vai em linha reta) |
| Cenário **VENDA**           | Alguém leva a bombona de 4 a 9 km, numa direção aleatória     |
| Cenário **DEVOLUÇÃO**       | A bombona volta para o local esperado                         |
| Cenário **SEM SINAL**       | O rastreador fica calado até passar o limite de sem sinal     |
| Cenário **BATERIA FRACA**   | A bateria cai para 14%                                        |
| Coleta registrada no painel | Quem estava com a bombona "perde" ela e o caminhão a leva ao pátio |
| Chegada ao pátio            | O rastreador é recarregado (bateria em 100%) e manda uma leitura na hora |

## Variáveis

| Variável              | Padrão                       | Descrição                                       |
|-----------------------|------------------------------|-------------------------------------------------|
| `API_URL`             | `http://localhost:3333/api`  | Endereço da API                                 |
| `SIM_TOKEN`           | `sim-demo-token`             | Token do canal de simulação (igual ao da API)   |
| `SIM_TICK_MS`         | `3000`                       | Intervalo do ciclo                              |
| `SIM_AUTO_VENDA_MIN`  | `0` (desligado)              | Sorteia uma "venda" a cada N minutos            |
| `ROTEADOR_URL`        | `https://router.project-osrm.org` | Serviço de rotas (OSRM) usado nas viagens do caminhão. O mapa usa o mesmo, via `VITE_ROTEADOR_URL` |
