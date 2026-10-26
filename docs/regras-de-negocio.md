# Regras de negócio (hipotéticas)

> Estas regras **não** vieram da Bio Óleo. Foram criadas para o protótipo, a partir do problema descrito
> (bombonas que somem porque o cliente vende, de propósito ou não). Os números (raios, tempos, limites)
> são parâmetros configuráveis e devem ser revistos com a empresa antes de qualquer uso real.

## Contexto assumido

A Bio Óleo deixa bombonas nos clientes (restaurantes, pastelarias, lanchonetes, indústrias de alimentos)
para armazenar óleo de cozinha usado. Periodicamente um caminhão passa, recolhe a bombona cheia e deixa
uma vazia. O óleo vira matéria-prima para biodiesel, o que é um ganho ambiental (logística reversa).

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

## Status da bombona

| Status       | Significado                                         | Local esperado               |
|--------------|-----------------------------------------------------|------------------------------|
| `PATIO`      | Na base da Bio Óleo                                 | Cerca do pátio               |
| `EM_ROTA`    | No caminhão, indo para um cliente ou voltando       | Nenhum (sem cerca)           |
| `EM_CLIENTE` | Alocada a um cliente                                | Cerca do cliente             |
| `EXTRAVIADA` | Longe demais do local esperado                      | Cerca do cliente de origem   |

## Regras

- **RN01 – Vínculo único.** Cada bombona tem exatamente um dispositivo, e cada dispositivo pertence a uma bombona.
- **RN02 – Cerca virtual.** Cada cliente tem um raio permitido (padrão 150 m). O pátio da Bio Óleo também tem
  uma cerca (padrão 250 m).
- **RN03 – Saída para entrega.** Ao registrar a saída de uma bombona do pátio para um cliente, ela passa a
  `EM_ROTA` com aquele cliente como destino. Só é possível enviar bombonas que estão no `PATIO`.
- **RN04 – Entrega confirmada pela chegada.** Quando uma bombona `EM_ROTA` envia uma leitura dentro da cerca do
  destino, ela passa a `EM_CLIENTE` (ou `PATIO`) automaticamente e é registrada uma movimentação de chegada.
  É o equivalente ao "pedido entregue" do iFood.
- **RN05 – Coleta.** Ao registrar a coleta, a bombona passa a `EM_ROTA` com destino ao pátio. Só é possível
  coletar bombonas `EM_CLIENTE` ou `EXTRAVIADA` (recuperação).
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
  resolve sozinho quando a bateria passa de 30%, depois da troca ou recarga.
- **RN12 – Um alerta aberto por tipo.** Uma bombona não pode ter dois alertas abertos do mesmo tipo.
- **RN13 – Bombona em rota não gera alerta de cerca.** Durante o transporte não existe local esperado.
- **RN14 – Risco do cliente.** O cliente acumula um histórico de incidentes, que é a quantidade de alertas
  `FORA_DA_AREA` ou `EXTRAVIO` ligados a ele. Classificação: 0 = baixo, 1–2 = médio, 3 ou mais = alto. Serve
  para a área comercial decidir se mantém o cliente ou cobra caução.
- **RN15 – Resolução manual.** O operador pode resolver qualquer alerta aberto, informando uma observação
  (ex.: "cliente devolveu, bombona estava no depósito dos fundos").
- **RN16 – Autenticação do dispositivo.** Leituras só são aceitas com o token do dispositivo. Se o token for
  desconhecido, a resposta é `401`. Se a coordenada ou a bateria forem inválidas, a resposta é `400`.

## Parâmetros

| Parâmetro               | Padrão (produção) | Demonstração | Variável de ambiente         |
|-------------------------|-------------------|--------------|------------------------------|
| Raio padrão do cliente  | 150 m             | 150 m        | cadastro do cliente          |
| Raio do pátio           | 250 m             | 250 m        | `PATIO_RAIO_M`               |
| Distância de extravio   | 2000 m            | 2000 m       | `EXTRAVIO_METROS`            |
| Tempo sem sinal         | 21600 s (6 h)     | 45 s         | `SEM_SINAL_SEGUNDOS`         |
| Bateria baixa           | 20%               | 20%          | `BATERIA_MINIMA`             |
