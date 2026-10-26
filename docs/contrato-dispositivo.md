# Contrato do dispositivo

Não sabemos qual hardware vai ficar preso à bombona. Por isso o sistema não depende de nenhum fabricante:
**qualquer dispositivo que consiga fazer uma requisição HTTP com o formato abaixo funciona**. Se o hardware
não falar HTTP (ex.: LoRaWAN), um gateway ou o servidor de rede do fabricante faz a tradução para este
contrato.

No protótipo, quem cumpre esse papel é o [simulador](../simulator), um processo separado que conversa com a
API **exatamente como um dispositivo real faria**.

## Envio de leitura

```
POST /api/telemetria
Authorization: Bearer <token-do-dispositivo>
Content-Type: application/json
```

```json
{
  "lat": -23.6634,
  "lng": -52.6054,
  "precisao": 12,
  "bateria": 87,
  "registradoEm": "2026-10-26T14:03:00.000Z"
}
```

| Campo          | Tipo   | Obrigatório | Descrição                                                    |
|----------------|--------|-------------|--------------------------------------------------------------|
| `lat`, `lng`   | número | sim         | Coordenada WGS84 (graus decimais)                            |
| `precisao`     | número | não         | Raio de incerteza do GPS em metros (padrão 0)                |
| `bateria`      | número | sim         | 0 a 100                                                      |
| `registradoEm` | texto  | não         | Hora da leitura no dispositivo (ISO 8601). Se ausente, vale a hora do servidor |

### Respostas

| Código | Quando                                  |
|--------|-----------------------------------------|
| `202`  | Leitura aceita                          |
| `400`  | Payload inválido                        |
| `401`  | Token ausente ou desconhecido           |

## Frequência sugerida

Uma bombona passa a maior parte do tempo parada, então não precisa de GPS ligado o tempo todo. Uma
estratégia econômica de bateria seria:

- **parada**: uma leitura a cada 1–2 h (o "estou viva");
- **com movimento detectado** (acelerômetro): uma leitura a cada 1–5 min até parar de novo.

A regra de "sem sinal" ([RN10](regras-de-negocio.md)) deve ser maior que o intervalo em repouso.

## Opções de hardware a investigar

| Tipo                               | Prós                                    | Contras                                   |
|------------------------------------|-----------------------------------------|-------------------------------------------|
| Rastreador GPS + GSM/LTE-M (NB-IoT) | Funciona em qualquer lugar com celular | Chip de dados por bombona, bateria        |
| GPS + LoRaWAN                       | Bateria dura anos, sem chip            | Precisa de cobertura/gateway LoRa na região |
| Tag BLE + gateway no cliente        | Tag barata                              | Só sabe se a bombona *está* no cliente; não segue a bombona depois que ela sai |
| Tag de rede colaborativa (estilo AirTag/SmartTag) | Muito barata          | Termos de uso proíbem rastrear bens de terceiros em escala; sem API oficial |
