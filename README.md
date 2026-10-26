# Rastreio de Bombonas · Bio Óleo

Protótipo **hipotético** de um sistema para rastrear as bombonas que a Bio Óleo (Cianorte-PR) deixa nos
clientes para coletar óleo de cozinha usado.

## O problema

Bombonas somem. O cliente vende para um sucateiro, empresta ou descarta (às vezes sem saber que a bombona
não é dele), e a empresa só descobre na hora da coleta. Isso gera prejuízo com a reposição e também perda
ambiental, porque o óleo que não é coletado tende a ir parar no esgoto.

## A proposta

Um rastreador em cada bombona, acompanhado num mapa **como o iFood acompanha o motoboy**. A diferença é que a
bombona quase sempre está parada, então o que importa é perceber quando ela **sai de onde deveria estar**:

- cada cliente tem uma **cerca virtual** em volta do endereço;
- quando a bombona sai da cerca, o sistema abre um alerta e passa a mostrar a **trilha** dela no mapa, em
  tempo real;
- se ela for longe demais, é marcada como **extraviada** e o cliente ganha um histórico de risco.

## Limitações assumidas

- **Não temos hardware.** O dispositivo é desconhecido, então o sistema define um
  [contrato HTTP](docs/contrato-dispositivo.md) que qualquer rastreador (ou gateway) pode cumprir. Os
  dispositivos são **simulados** por um processo separado.
- **Não conhecemos as regras da empresa.** As [regras de negócio](docs/regras-de-negocio.md) são hipóteses
  documentadas e parametrizáveis.
- Clientes, endereços e números são **fictícios**.

## Arquitetura

```
┌─────────────┐  POST /api/telemetria   ┌──────────────────────┐   SSE /api/eventos   ┌───────────────┐
│ Dispositivo │ ──────────────────────▶ │ API (Node + Express) │ ───────────────────▶ │ Painel (React │
│ (simulador) │   token por dispositivo │ motor de regras      │ ◀─────────────────── │  + Leaflet)   │
└─────────────┘                         │ SQLite               │     REST /api/...    └───────────────┘
                                        └──────────────────────┘
```

| Pasta        | O quê                                                                           |
|--------------|---------------------------------------------------------------------------------|
| `server/`    | API REST, recebimento de telemetria, motor de regras, eventos em tempo real     |
| `simulator/` | Imita os rastreadores: envia posição e bateria e executa cenários de desvio     |
| `web/`       | Painel do operador: mapa ao vivo, bombonas, alertas, clientes                   |
| `docs/`      | Regras de negócio, contrato do dispositivo e divisão de tarefas                 |

## Como rodar

Requisitos: **Node.js 23.6+** (o back-end roda TypeScript direto e usa o SQLite embutido no Node).

```bash
npm install
npm run dev
```

Isso sobe três processos:

- API em http://localhost:3333
- painel em http://localhost:5173
- simulador dos dispositivos

O banco (`server/data/bombonas.db`) é criado e populado na primeira execução. Para começar do zero, apague o
arquivo.

Outros comandos:

```bash
npm test           # testes do back-end (motor de regras e API)
npm run typecheck  # checagem de tipos em todos os pacotes
```

## Roteiro de demonstração

1. Abra o painel. As bombonas aparecem nos clientes, em Cianorte e nas cidades vizinhas.
2. Clique numa bombona `EM_CLIENTE` e, em **Simulação**, escolha **Cliente vendeu a bombona**.
3. Em poucos segundos ela sai da cerca: abre o alerta `FORA_DA_AREA` e a trilha começa a ser desenhada.
4. Passando de 2 km, ela vira `EXTRAVIADA` e o cliente sobe no ranking de risco.
5. Registre a **coleta** (recuperação): a bombona volta ao pátio pelo caminho.

## Divisão de tarefas

Veja [docs/tasks.md](docs/tasks.md).
