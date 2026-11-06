# Ajustes a partir da apresentação da Bio Óleo · design

> 2026-11-05 · design aprovado · fonte: apresentação da Bio Óleo em aula (Aula 07, Cristiane Marchini Roco),
> guardada fora do repositório

## Intenção

A apresentação da Bio Óleo trouxe dados reais da operação. O protótipo continua resolvendo o **mesmo problema**:
o sumiço por venda clandestina, que não aparece nos slides mas é o problema trabalhado. Os ajustes servem para
deixar o protótipo mais fiel à empresa e para cobrir um caso que ele ainda não pega: o cliente vende **o óleo**
e a bombona fica parada no lugar, então a cerca virtual não percebe nada.

Dados reais usados: 1.453 pontos atendidos, em mais de 70 municípios do PR, num raio de 250 km de Cianorte; os
veículos são furgões e já são rastreados em tempo real; cada coleta é paga pelos litros coletados (o lançamento
da coleta gera o pagamento e a nota fiscal, cerca de 600 por mês); as bombonas têm lacre com trava.

## Objetivos

1. **Litros na coleta.** A coleta normal registra quantos litros foram coletados.
2. **Coleta abaixo do esperado.** Uma regra nova avisa o operador quando a coleta rende bem menos que o
   histórico do cliente, que é o sinal de desvio do óleo.
3. **Escala real.** Os clientes ficam espalhados pelo raio de atendimento, e não só em volta de Cianorte.
4. **Furgão** no lugar de "caminhão".
5. **Textos.** README e regras de negócio citam a apresentação como fonte do que agora é conhecido.

## Fora do escopo

- Valor pago, nota fiscal ou qualquer parte financeira (só os litros).
- Coleta residencial (Projeto Reciclaóleo).
- Regra de lacre violado (proposta e descartada).
- Contar a coleta abaixo do esperado no risco do cliente.

## Antiobjetivos

- A regra nova não pode tratar rendimento baixo como fraude: um restaurante pode ter tido um mês fraco. Ela
  não muda o status da bombona e não pune o cliente.
- A escala não pode deixar a demonstração lenta.

## Abordagens consideradas (escala)

| | Abordagem | Troca |
|---|---|---|
| **A (escolhida)** | Clientes longe, velocidade do furgão proporcional à distância (teto de ~90 s por viagem) | Uma linha no simulador; a velocidade acelerada fica mais irreal nas viagens longas, mas não aparece na tela |
| B | Clientes longe, velocidade fixa | Mais fiel, mas uma entrega em Maringá leva ~15 min de demonstração |
| C | Clientes continuam perto, números reais só no texto | Nenhum trabalho, mas o mapa continua parecendo de uma cidade só |

Escolhida a **A** porque mostra o alcance real no mapa sem custo na apresentação. O resto não tinha escolha real:
estender o que já existe.

## Como fica

### 1. Litros na coleta (RN17)
- `POST /api/bombonas/:codigo/coleta` recebe `litros` (inteiro). **Obrigatório na coleta normal**
  (`EM_CLIENTE`) e ignorado na recuperação (`EXTRAVIADA`), porque o óleo de uma bombona extraviada não
  representa o cliente.
- Validação: `litros` entre 0 e a capacidade da bombona (`capacidade_l`); fora disso, `400`.
- Guardado na movimentação `COLETA` (coluna nova `movimentacoes.litros`, que pode ser nula).
- No painel, o formulário de coleta (`web/src/paginas/AcoesBombona.tsx`) ganha o campo "Litros coletados"; ele
  não aparece na recuperação. A linha do tempo mostra os litros da coleta.

### 2. Coleta abaixo do esperado (RN18)
- **Esperado** = média de litros das últimas `N` coletas normais **anteriores** daquele cliente (padrão `N = 3`).
  Com menos de `N` coletas no histórico, a regra não roda.
- Se `litros < esperado × P%` (padrão `P = 50`), abre o alerta `COLETA_ABAIXO`, severidade `AVISO`, com
  `cliente_id` do cliente. Mensagem: litros coletados × esperado. Exemplo: "Coleta de 20 L, esperado ~50 L".
- Só aviso: **não** conta no risco (a consulta de risco já filtra `FORA_DA_AREA`, então isso sai de graça) e
  **não** muda o status da bombona.
- Resolve só manualmente, com observação (RN15).
- RN12 (um alerta aberto por tipo e bombona): se a bombona já tiver um `COLETA_ABAIXO` aberto, ele é
  resolvido automaticamente ("substituído por uma coleta mais recente") antes de abrir o novo.
- Parâmetros novos: `COLETA_HISTORICO_N` (3) e `COLETA_MINIMO_PCT` (50), na tabela de parâmetros.
- Aparece na tela Alertas e como aviso ao vivo no mapa, igual aos outros alertas.

### 3. Escala
- Seed com cerca de 25 clientes em 12 a 15 cidades dentro de 250 km de Cianorte (ex.: Umuarama, Maringá,
  Campo Mourão, Paranavaí, Cianorte e vizinhas). Coordenadas reais e endereços fictícios, com cada cliente em
  cima de uma rua (o OSRM precisa chegar até ele).
- O seed passa a ter de 3 a 6 coletas antigas com litros por cliente, em torno de uma média própria de cada um
  (sem passar da capacidade), para a regra nova ter histórico já na demonstração.
- As duas saídas automáticas do início continuam indo para clientes perto.
- Simulador: passo do furgão = `max(100 m/s, distância da rota / 90 s)`, calculado por viagem quando a rota
  chega. A venda (extravio) continua a 73 m/s. A previsão de chegada não muda, porque usa a velocidade medida.

### 4. Furgão
- Trocar "caminhão" por "furgão" nos textos da tela, docs, logs e identificadores (ex.: `PASSO_CAMINHAO_M`).
  São cerca de 36 ocorrências.

### 5. Textos
- README: a seção "Limitações assumidas" deixa de dizer que não conhecemos a empresa e passa a citar o que veio
  da apresentação (números acima). O roteiro de demonstração ganha um passo: registrar uma coleta com poucos
  litros e ver o aviso.
- `docs/regras-de-negocio.md`: "Contexto assumido" com os dados reais, mais RN17, RN18 e os dois parâmetros.

## Restrições

- **Banco existente.** O `CHECK` de `alertas.tipo` não aceita o tipo novo, e o `CREATE TABLE IF NOT EXISTS` não
  altera tabela existente. Um banco criado antes da mudança precisa ser recriado (o seed é sintético). Usar
  `PRAGMA user_version`: com versão antiga, apagar e recriar sozinho, sem depender de o usuário apagar o arquivo.
- Node 23.6+, SQLite embutido, sem dependência nova.
- Os testes atuais (32) continuam passando. Testes novos: litros obrigatórios e validados; regra dispara abaixo
  de P% com N coletas; não dispara com menos de N; não conta no risco; recuperação não pede litros; a
  substituição respeita a RN12.

## Fica para quem implementar

- Nomes exatos dos clientes e das cidades do seed e as médias de cada um.
- Texto final das mensagens e rótulos.
- Se a média de litros aparece também na tela Clientes (opcional, não pedido).
