# Simulador de rastreadores

Faz o papel do hardware que ainda não existe. Cada bombona envia a própria posição pelo
[contrato público](../docs/contrato-dispositivo.md) (`POST /api/telemetria` com o token do dispositivo),
exatamente como um aparelho real faria.

Para saber onde cada bombona deveria estar e quais cenários o painel pediu, o simulador consulta o canal de
controle da demonstração (`GET /api/simulacao/estado`). Esse canal não existiria num cenário real.

## Comportamento

| Situação                    | O que o "rastreador" faz                                      |
|-----------------------------|---------------------------------------------------------------|
| Parada (pátio/cliente)      | Fica no lugar, sem ruído, e manda sinal a cada segundo        |
| `EM_ROTA`                   | Anda pelas ruas até o destino, como se estivesse no furgão, e continua até o ponto mesmo depois de a chegada ser confirmada na borda da cerca |
| Cenário **VENDA**           | Alguém leva a bombona pelas ruas, de 4 a 9 km, numa direção aleatória, e para numa rua |
| Cenário **DEVOLUÇÃO**       | A bombona volta pelas ruas para o local esperado              |
| Cenário **SEM SINAL**       | O rastreador fica calado até passar o limite de sem sinal     |
| Cenário **BATERIA FRACA**   | A bateria cai para 14%                                        |
| Coleta registrada no painel | Quem estava com a bombona "perde" ela e o furgão a leva ao pátio |
| Chegada ao pátio            | O rastreador é recarregado (bateria em 100%) e manda uma leitura na hora |

## Variáveis

| Variável              | Padrão                       | Descrição                                       |
|-----------------------|------------------------------|-------------------------------------------------|
| `API_URL`             | `http://localhost:3333/api`  | Endereço da API                                 |
| `SIM_TOKEN`           | `sim-demo-token`             | Token do canal de simulação (igual ao da API)   |
| `SIM_TICK_MS`         | `250`                        | Intervalo do ciclo (leitura em movimento)       |
| `SIM_AUTO_VENDA_MIN`  | `0` (desligado)              | Sorteia uma "venda" a cada N minutos            |
| `ROTEADOR_URL`        | `https://router.project-osrm.org` | Serviço de rotas (OSRM) usado em todas as viagens; sem resposta dele, a bombona espera e tenta de novo. O mapa usa o mesmo, via `VITE_ROTEADOR_URL` |
