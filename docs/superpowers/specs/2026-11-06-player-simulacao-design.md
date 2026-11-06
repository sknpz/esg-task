# Player da simulação (play/pause, reset e velocidade) · design

Data: 2026-11-06 · Branch: `feat/contratos-rotas` · Autor: Matheus (decisões) com Claude (redação)

## Intenção

A versão com contratos e rotas é apresentada como uma demonstração ao vivo: o calendário anda sozinho (~2 min por
dia simulado), os furgões saem, trocam bombonas e voltam. Hoje o operador só tem um botão "Pausar/Continuar" no
cabeçalho. Para apresentar bem, ele precisa controlar a demonstração **como um vídeo**:

- começar quando quiser (a simulação nasce parada, esperando o play);
- voltar tudo ao começo entre uma apresentação e outra (reset), sem apagar arquivo nem reiniciar processo;
- acelerar quando a plateia já entendeu o ciclo (2x).

O `main` (jeito antigo, envio/coleta por botão) não muda.

### Contexto: o lag dos furgões não faz parte deste trabalho

Os furgões andavam aos pulos (uma posição a cada ~750 ms em vez de 250 ms, com buracos de até 4,4 s). A causa
medida foi o banco SQLite no pendrive (FAT32, gravação lenta) somado às ~25 leituras por ciclo da versão nova. Com o
banco no disco do PC o ciclo volta a 250 ms cravados. Decisão: rodar de um **clone no disco do PC**, sem mudar
código. Este trabalho só acrescenta uma nota no README (ver "README").

## Objetivos

1. **Barra de player** abaixo do cabeçalho, visível em todas as abas, com: play/pause, reset, velocidade (1x/2x),
   a data simulada e uma barra que enche ao longo do dia simulado (Manhã → Furgões na rua → Fim do dia).
2. **Começa parada:** num banco recém-criado a operação fica pausada na manhã do primeiro dia (seg, 09/11) até o
   primeiro play.
3. **Reset:** volta tudo ao estado de um banco recém-criado e fica parado esperando o play.
4. **Velocidade 2x:** todo o mundo simulado anda em dobro, e o movimento dos furgões continua liso.

## Não objetivos

- Arrastar a barra para pular no tempo, voltar no tempo, velocidades além de 2x.
- Mudar o que os rastreadores mandam (cada bombona dentro do furgão continua mandando a própria posição).
- Mexer no `main`.
- Corrigir o lag por código (ver "Contexto").

## Anti-objetivos (falha mesmo que "funcione")

- Depois do reset sobrar qualquer resto da rodada anterior: furgão ou traçado no mapa, aviso na tela, contador de
  alertas, bombona "vendida" no simulador, contrato criado ao vivo.
- Em 2x os furgões voltarem a andar aos pulos.
- Um clique sem querer no reset destruir a apresentação (por isso a confirmação).

## Comportamento decidido

### Barra de player (escolhida entre três rascunhos: "opção B")

- Faixa fina logo abaixo do cabeçalho (`.topo`), acima do aviso de protótipo, em todas as rotas.
- Da esquerda para a direita: botão play/pause (verde, destaque), botão reset, botão de velocidade, data
  (`seg, 09/11`) com "· dia N" (N = dias de operação desde o início, começando em 1), e a barra de andamento com
  três marcas: **Manhã**, **Furgões na rua**, **Fim do dia**.
- O bloco `.operacao` atual do cabeçalho (data + botão Pausar/Continuar) **sai**; a data passa para a barra. O
  indicador "Ao vivo" fica no cabeçalho.
- Celular: a barra pode quebrar em duas linhas (botões e data em cima, barra de andamento embaixo); nada de rolagem
  horizontal.

### Play/pause

- Um botão que alterna ▶/⏸ e reaproveita `POST /operacao/pausar` e `POST /operacao/continuar` (o pause já congela
  tudo: relógio, furgões, vendas e devoluções; os parados continuam mandando a última posição).
- **Pausado, o mundo simulado fica congelado de verdade** (decisão do Claude, a partir do "parada esperando o
  play"): a demonstração pode ficar minutos parada antes da apresentação, e a plateia não pode ver um alerta que
  nasceu nesse tempo. Hoje não é assim: o simulador gasta bateria a cada ciclo mesmo pausado (BO-0007 começa com
  21% e abre BATERIA_BAIXA em ~5 min), e o silêncio do cenário "sem sinal" (`caladoAte`) e a varredura de "sem
  sinal" do servidor contam pelo relógio real. Pausado: a bateria não cai, o silêncio do cenário não corre e o prazo
  de "sem sinal" do servidor não vence (ao continuar, conta só o tempo rodando).
- **Banco recém-criado nasce pausado** (hoje `estadoOperacao` cria a linha com `pausado = 0`). A manhã do primeiro
  dia já está planejada, como hoje; só não avança.

### Reset

- Botão ⟲ abre uma **confirmação curta na própria página** (não `window.confirm`), por exemplo: "Voltar a simulação
  ao começo? Tudo o que aconteceu (coletas, alertas, contratos criados) será apagado." com "Voltar ao começo" e
  "Cancelar".
- Confirmado: o servidor deixa o banco **igual a um recém-criado** (mesmo seed, mesma data inicial, manhã,
  **pausado**, velocidade **1x**) e todos os painéis abertos e o simulador recomeçam desse estado. Nas palavras do
  Matheus: a tela volta a ficar "como a simulação começou".
- **O seed vence:** o que o seed cria continua existindo depois do reset, inclusive o **histórico** dele (alertas
  antigos já resolvidos, coletas passadas que alimentam os litros esperados e a RN18, e o ranking de risco que sai
  desses incidentes) e os roteiros da primeira manhã, já planejados como num banco novo. Some só o que foi criado
  durante a rodada: alertas, coletas, leituras, roteiros, comandos de simulação, o contrato criado ao vivo (o
  cliente volta a ficar sem contrato) e as mudanças no estoque do pátio.
- "Igual" quer dizer mesmas contagens e mesmos estados; ids e tokens dos rastreadores podem mudar (decisão do
  Claude). Qualquer que seja o jeito, um pedido do simulador que saiu antes do reset (posição, trajeto, troca,
  conclusão, leitura) **não pode mexer na rodada nova**; se os ids se repetirem, isso exige uma checagem explícita
  de rodada nas rotas do simulador.

### Velocidade

- Um botão que alterna **1x ↔ 2x** e mostra a velocidade atual. Vale enquanto rodando ou pausado.
- Em 2x, tudo que é tempo do mundo simulado cai pela metade:
  - relógio da operação: manhã e fim do dia (`fasePausaS`) duram metade;
  - furgões: o roteiro inteiro dura metade (~45 s em vez de ~90 s), incluindo a pausa em cada parada;
  - viagens avulsas do simulador (venda clandestina, devolução, recuperação): andam o dobro;
  - consumo de bateria por tempo: dobra;
  - prazos de alerta por tempo: "sem sinal" (`semSinalSegundos`, padrão 45 s) cai pela metade, e o silêncio do
    cenário "sem sinal" do simulador acompanha: `(semSinalSegundos + 25) / velocidade` (35 s em 2x; decisão do
    Claude). Hoje o simulador lê `semSinalSegundos` uma vez só, ao subir; a conta tem de usar a velocidade atual;
  - vendas sorteadas "por dia simulado" já acompanham sozinhas (o dia fica mais curto).
- **Movimento liso:** o simulador mantém o ciclo de 250 ms (4 posições por segundo); em 2x cada passo fica maior. Não
  diminuir o ciclo (isso dobraria as gravações por segundo).
- Mudança de velocidade no meio de uma viagem vale a partir do próximo ciclo; o furgão não precisa recalcular a rota.
- Reset volta para 1x.

## Estado e contratos (decisões do design)

- A velocidade é estado da operação no servidor (junto de `pausado`), devolvida em `GET /operacao` e no evento SSE
  `operacao`; persiste num reinício do servidor.
- Rotas novas, sem token, como `pausar`/`continuar`:
  - `POST /operacao/velocidade` com `{ "velocidade": 1 | 2 }` (outro valor → 400);
  - `POST /operacao/reset`.
- O simulador lê a velocidade em `GET /simulacao/estado` (vem em `operacao`) a cada ciclo.
- O simulador precisa **perceber o reset** e jogar fora todo o estado em memória (aparelhos, frota, vendas,
  devoluções, "rastreador arrancado", data vista), recomeçando como se tivesse acabado de subir. Também precisa
  ignorar respostas de pedidos que estavam no ar no momento do reset (um POST antigo de troca ou posição não pode
  mexer no banco novo).
- Os painéis precisam perceber o reset e recarregar tudo (bombonas, roteiros, alertas, indicadores, clientes), além
  de limpar os avisos na tela e a seleção do mapa.
- `inicioDaPausa` (em memória no servidor) não pode sobreviver ao reset.

## Barra de andamento

- Enche de 0% (começo da manhã) a 100% (fim do "Fim do dia"), **nunca volta para trás dentro do mesmo dia** e volta a
  0% quando o dia vira.
- Três trechos: Manhã, Furgões na rua, Fim do dia. Manhã e Fim do dia têm duração conhecida (`fasePausaS`, já
  ajustada pela velocidade). O trecho "Furgões na rua" não tem duração fixa (termina quando o último furgão volta).
- Parada (pause), a barra congela.

## README

- Em "Como rodar": rodar de um clone no disco do PC; no pendrive (FAT32) o `npm install` da raiz falha e o banco fica
  lento a ponto de os furgões andarem aos pulos.
- Em "Roteiro de demonstração": o player (começa parado, play, 2x, reset entre apresentações).

## Testes esperados

- Servidor: banco novo nasce pausado; reset deixa o banco igual a um recém-criado (mesmas contagens, incluindo o
  histórico do seed, e mesmo estado da operação) e emite o evento que os painéis usam; pedido do simulador anterior
  ao reset é recusado; pausado, o prazo de "sem sinal" não vence; velocidade 2x encurta manhã/fim e o prazo de "sem sinal"; valor de
  velocidade inválido → 400.
- Simulador: passo do furgão e das viagens avulsas dobra em 2x com o mesmo ciclo; reset descarta o estado em memória;
  pausado, a bateria não cai.
- Conferência no navegador antes de qualquer push (decisão do Matheus): um dia inteiro em 1x e em 2x sem pulos, pause,
  reset no meio de uma rota sem restos na tela.

## Deixado para quem for construir

- Como o reset é feito por dentro (apagar e repopular tabelas na mesma conexão, recriar o arquivo etc.), desde que o
  resultado seja igual a um banco recém-criado e o servidor não precise reiniciar.
- Como o simulador e os painéis percebem o reset (evento SSE próprio, contador de "rodada" no estado etc.).
- Como calcular o andamento do trecho "Furgões na rua" (fração do trajeto percorrida pelos furgões, paradas feitas,
  tempo decorrido sobre o esperado), respeitando "enche continuamente e nunca volta".
- Ícones, textos e estilo, seguindo o visual atual (verde `--verde`, botões `.botao`).
- Onde guardar a velocidade no banco (coluna nova em `operacao` exige subir `VERSAO_ESQUEMA`, o que recria bancos
  antigos: aceitável, os dados são de demonstração).
