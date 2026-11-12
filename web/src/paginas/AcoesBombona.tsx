import { useState } from 'react';
import { api, type Bombona, type Cenario } from '../api.ts';
import { useMonitoramento } from '../monitoramento.tsx';

/** Ações da bombona no painel: só a recuperação de uma extraviada. Entrega e coleta de rotina vêm dos roteiros. */
export function AcoesBombona({ bombona: b }: { bombona: Bombona }) {
  const { atualizarBombona } = useMonitoramento();
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (b.status !== 'EXTRAVIADA') {
    return (
      <p className="suave">
        {b.status === 'EM_ROTA'
          ? 'A entrega e a chegada ao pátio são confirmadas automaticamente quando o rastreador entra na cerca do destino.'
          : 'Entregas e coletas seguem os contratos: o furgão faz as trocas, veja a aba Coletas do dia.'}
      </p>
    );
  }

  const registrar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      atualizarBombona(await api.coletar(b.codigo, { observacao }));
      setObservacao('');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form
      className="acao"
      onSubmit={(e) => {
        e.preventDefault();
        registrar();
      }}
    >
      <label className="acao__rotulo" htmlFor="obs-coleta">
        Bombona encontrada? Registre a recuperação
      </label>
      <input
        id="obs-coleta"
        className="campo"
        placeholder="Onde estava? (ex.: ferro-velho da Av. Brasil)"
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
      />
      <button className="botao botao--perigo" disabled={enviando}>
        Registrar recuperação
      </button>
      {erro && <p className="erro">{erro}</p>}
    </form>
  );
}

const CENARIOS: Array<{ tipo: Cenario; rotulo: string; dica: string }> = [
  { tipo: 'VENDA', rotulo: 'Cliente vendeu a bombona', dica: 'Alguém leva a bombona de 4 a 9 km dali' },
  { tipo: 'DEVOLUCAO', rotulo: 'Devolver ao lugar', dica: 'A bombona volta para o local esperado' },
  { tipo: 'SEM_SINAL', rotulo: 'Cortar o sinal', dica: 'O rastreador fica calado por alguns segundos' },
  { tipo: 'BATERIA_FRACA', rotulo: 'Bateria fraca', dica: 'A bateria do rastreador cai para 14%' },
];

/** Controles da demonstração: pedem ao simulador que finja um acontecimento. */
export function SimulacaoBombona({ bombona: b }: { bombona: Bombona }) {
  const [mensagem, setMensagem] = useState<string | null>(null);
  const foraDoLugar = b.status === 'EXTRAVIADA' || b.alertasAbertos.includes('FORA_DA_AREA');

  const pedir = async (tipo: Cenario, rotulo: string) => {
    try {
      await api.simular(b.codigo, tipo);
      setMensagem(`“${rotulo}” enviado ao simulador. Acompanhe no mapa.`);
    } catch (e) {
      setMensagem((e as Error).message);
    }
  };

  return (
    <div className="simulacao">
      <div className="simulacao__botoes">
        {CENARIOS.filter((c) => (c.tipo === 'DEVOLUCAO' ? foraDoLugar : c.tipo === 'VENDA' ? b.status !== 'EM_ROTA' && !foraDoLugar : true)).map(
          (c) => (
            <button key={c.tipo} className="botao botao--simulacao" title={c.dica} onClick={() => pedir(c.tipo, c.rotulo)}>
              {c.rotulo}
            </button>
          ),
        )}
      </div>
      {mensagem && <p className="suave simulacao__msg">{mensagem}</p>}
    </div>
  );
}
