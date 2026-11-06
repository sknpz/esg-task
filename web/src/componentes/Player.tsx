import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { andamentoDoDia } from '../andamento.ts';
import { formatarDataOperacao } from '../formato.ts';
import { useMonitoramento } from '../monitoramento.tsx';

/** Barra de player do dia simulado: play/pause, volta ao começo, velocidade e andamento do dia. */
export function Player() {
  const { operacao, roteiros } = useMonitoramento();
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [andamento, setAndamento] = useState(0);

  // O andamento só avança dentro do dia: leituras atrasadas dos furgões não fazem a barra recuar.
  const maximo = useRef({ chave: '', valor: 0 });
  const ultimo = useRef({ operacao, roteiros });
  ultimo.current = { operacao, roteiros };

  const atualizar = useRef(() => {
    const { operacao: op, roteiros: rs } = ultimo.current;
    if (!op) return;
    const chave = `${op.rodada}|${op.data}`;
    if (maximo.current.chave !== chave) maximo.current = { chave, valor: 0 };
    maximo.current.valor = Math.max(maximo.current.valor, andamentoDoDia(op, rs, Date.now()));
    setAndamento(maximo.current.valor);
  }).current;

  // Mudou o estado ou os furgões: recalcula na hora. Rodando, recalcula também a cada 250 ms; pausado, congela.
  useEffect(() => {
    atualizar();
  }, [operacao, roteiros, atualizar]);
  const rodando = operacao !== null && !operacao.pausado;
  useEffect(() => {
    if (!rodando) return;
    const relogio = window.setInterval(atualizar, 250);
    return () => window.clearInterval(relogio);
  }, [rodando, atualizar]);

  if (!operacao) return null;

  const executar = async (acao: () => Promise<unknown>) => {
    setOcupado(true);
    setErro(null);
    try {
      await acao(); // o estado novo chega pelos eventos 'operacao' e 'reset'
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Sem resposta do servidor.');
    } finally {
      setOcupado(false);
    }
  };

  if (confirmando) {
    return (
      <div className="player player--confirmando" role="alertdialog" aria-label="Voltar ao começo">
        <span className="player__pergunta">
          Voltar a simulação ao começo? Tudo o que aconteceu (coletas, alertas, contratos criados) será apagado.
        </span>
        <span className="player__botoes">
          <button
            type="button"
            className="botao botao--perigo botao--pequeno"
            disabled={ocupado}
            onClick={() =>
              void executar(async () => {
                await api.resetar();
                setConfirmando(false);
              })
            }
          >
            Voltar ao começo
          </button>
          <button type="button" className="botao botao--pequeno" disabled={ocupado} onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </span>
        {erro && <span className="player__erro">{erro}</span>}
      </div>
    );
  }

  const proxima = operacao.velocidade === 1 ? 2 : 1;
  return (
    <div className="player">
      <div className="player__controles">
        <button
          type="button"
          className="botao botao--primario botao--pequeno player__botao"
          disabled={ocupado}
          aria-label={operacao.pausado ? 'Continuar a simulação' : 'Pausar a simulação'}
          title={operacao.pausado ? 'Continuar' : 'Pausar'}
          onClick={() => void executar(() => (operacao.pausado ? api.continuar() : api.pausar()))}
        >
          {operacao.pausado ? '▶' : '⏸'}
        </button>
        <button
          type="button"
          className="botao botao--pequeno player__botao"
          disabled={ocupado}
          aria-label="Voltar a simulação ao começo"
          title="Voltar ao começo"
          onClick={() => setConfirmando(true)}
        >
          ⟲
        </button>
        <button
          type="button"
          className="botao botao--pequeno player__botao"
          disabled={ocupado}
          aria-label={`Velocidade ${operacao.velocidade}x (trocar para ${proxima}x)`}
          title="Trocar a velocidade"
          onClick={() => void executar(() => api.velocidade(proxima))}
        >
          {operacao.velocidade}x
        </button>
        <span className="player__data" title="Data simulada da operação">
          {formatarDataOperacao(operacao.data)} <span className="player__dia">· dia {operacao.dia}</span>
        </span>
      </div>
      <div className="player__andamento">
        <div className="player__trilho" role="progressbar" aria-label="Andamento do dia" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(andamento * 100)}>
          <div className="player__feito" style={{ width: `${andamento * 100}%` }} />
        </div>
        <div className="player__marcas">
          <span>Manhã</span>
          <span>Furgões na rua</span>
          <span>Fim do dia</span>
        </div>
      </div>
      {erro && <span className="player__erro">{erro}</span>}
    </div>
  );
}
