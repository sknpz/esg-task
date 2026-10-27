import { useState } from 'react';
import { api, type Bombona, type Cenario } from '../api.ts';
import { useMonitoramento } from '../monitoramento.tsx';

/** Operações do dia a dia: entrega, coleta e recuperação. */
export function AcoesBombona({ bombona: b }: { bombona: Bombona }) {
  const { clientes, atualizarBombona } = useMonitoramento();
  const [clienteId, setClienteId] = useState('');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const executar = async (acao: () => Promise<Bombona>) => {
    setEnviando(true);
    setErro(null);
    try {
      atualizarBombona(await acao());
      setObservacao('');
      setClienteId('');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  if (b.status === 'EM_ROTA') {
    return (
      <p className="suave">
        A {b.destino?.nome === 'Pátio Bio Óleo' ? 'chegada ao pátio' : 'entrega'} é confirmada automaticamente quando o rastreador
        entrar na cerca do destino.
      </p>
    );
  }

  if (b.status === 'PATIO') {
    return (
      <form
        className="acao"
        onSubmit={(e) => {
          e.preventDefault();
          executar(() => api.entregar(b.codigo, Number(clienteId), observacao));
        }}
      >
        <label className="acao__rotulo" htmlFor="cliente-destino">
          Enviar para o cliente
        </label>
        <select id="cliente-destino" className="campo" value={clienteId} onChange={(e) => setClienteId(e.target.value)} required>
          <option value="">Escolha o cliente…</option>
          {[...clientes]
            .sort((x, y) => x.nome.localeCompare(y.nome))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} · {c.cidade}
                {c.risco === 'ALTO' ? ' (risco alto)' : ''}
              </option>
            ))}
        </select>
        <button className="botao botao--primario" disabled={enviando || !clienteId}>
          Registrar saída para entrega
        </button>
        {erro && <p className="erro">{erro}</p>}
      </form>
    );
  }

  const recuperacao = b.status === 'EXTRAVIADA';
  return (
    <form
      className="acao"
      onSubmit={(e) => {
        e.preventDefault();
        executar(() => api.coletar(b.codigo, observacao));
      }}
    >
      <label className="acao__rotulo" htmlFor="obs-coleta">
        {recuperacao ? 'Bombona encontrada? Registre a recuperação' : 'Coleta'}
      </label>
      <input
        id="obs-coleta"
        className="campo"
        placeholder={recuperacao ? 'Onde estava? (ex.: ferro-velho da Av. Brasil)' : 'Observação (opcional)'}
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
      />
      <button className={`botao ${recuperacao ? 'botao--perigo' : 'botao--primario'}`} disabled={enviando}>
        {recuperacao ? 'Registrar recuperação' : 'Registrar coleta'}
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
