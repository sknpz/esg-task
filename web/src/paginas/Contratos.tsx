import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type Contrato, type EntradaContrato, type Frequencia, type Ponto } from '../api.ts';
import { MapaPonto } from '../componentes/MapaPonto.tsx';
import { aplicarDiaDoInicio } from '../diaDoContrato.ts';
import { dataCurta, nomeDia, rotuloFrequencia } from '../formato.ts';
import { useMonitoramento } from '../monitoramento.tsx';

const FREQUENCIAS: { valor: Frequencia; rotulo: string }[] = [
  { valor: 'DIARIA', rotulo: 'Diária' },
  { valor: 'SEMANAL', rotulo: 'Semanal' },
  { valor: 'QUINZENAL', rotulo: 'Quinzenal' },
  { valor: 'MENSAL', rotulo: 'Mensal' },
];
const DIAS_UTEIS = [1, 2, 3, 4, 5, 6]; // seg a sáb; domingo nunca tem coleta

/** O cliente digitado no "Novo contrato". */
type ClienteNovo = { nome: string; tipo: string; cidade: string; endereco: string; ponto: Ponto | null };

type Formulario = {
  /** true: cadastra um cliente novo junto; false: usa um cliente já cadastrado (`clienteId`). */
  clienteNovo: boolean;
  novo: ClienteNovo;
  clienteId: number | null;
  quantidade: string;
  frequencia: Frequencia;
  diasSemana: number[];
  diaMes: string;
  inicio: string;
};

const novoVazio = (): ClienteNovo => ({ nome: '', tipo: '', cidade: '', endereco: '', ponto: null });

const vazio = (inicio: string): Formulario => ({
  clienteNovo: true,
  novo: novoVazio(),
  clienteId: null,
  quantidade: '1',
  frequencia: 'SEMANAL',
  diasSemana: [],
  diaMes: '1',
  inicio,
});

const doContrato = (c: Contrato): Formulario => ({
  clienteNovo: false,
  novo: novoVazio(),
  clienteId: c.clienteId,
  quantidade: String(c.quantidade),
  frequencia: c.frequencia,
  diasSemana: c.diasSemana,
  diaMes: String(c.diaMes ?? 1),
  inicio: c.inicio,
});

function paraEntrada(f: Formulario): EntradaContrato {
  const { nome, tipo, cidade, endereco, ponto } = f.novo;
  const cliente: Pick<EntradaContrato, 'clienteId' | 'novoCliente'> =
    f.clienteNovo && ponto ? { novoCliente: { nome, tipo, cidade, endereco, lat: ponto.lat, lng: ponto.lng } } : { clienteId: f.clienteId ?? 0 };
  return {
    ...cliente,
    quantidade: Number(f.quantidade),
    frequencia: f.frequencia,
    diasSemana: f.frequencia === 'SEMANAL' || f.frequencia === 'QUINZENAL' ? f.diasSemana : [],
    diaMes: f.frequencia === 'MENSAL' ? Number(f.diaMes) : null,
    inicio: f.inicio,
  };
}

export function Contratos() {
  const { clientes, operacao, config, recarregar } = useMonitoramento();
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [editando, setEditando] = useState<Contrato | 'novo' | null>(null);
  const [form, setForm] = useState<Formulario>(vazio(''));
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(() => api.contratos().then(setContratos).catch((e: Error) => setErro(e.message)), []);
  // Recarrega ao montar e quando a simulação volta ao começo (o formulário aberto aponta para um contrato apagado).
  const rodada = operacao?.rodada;
  useEffect(() => {
    setEditando(null);
    void carregar();
  }, [carregar, rodada]);

  const ativos = contratos.filter((c) => c.situacao === 'ATIVO');
  const encerrados = contratos.filter((c) => c.situacao === 'ENCERRADO');
  const semContrato = useMemo(() => clientes.filter((c) => !c.contratoAtivo), [clientes]);
  const tipos = useMemo(() => [...new Set(clientes.map((c) => c.tipo))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [clientes]);

  const abrirNovo = () => {
    setEditando('novo');
    // Já vem com o dia do Início marcado (semanal, o dia da semana de hoje).
    setForm(aplicarDiaDoInicio({ ...vazio(operacao?.data ?? ''), clienteId: semContrato[0]?.id ?? null }));
    setErro(null);
  };
  const abrirEdicao = (c: Contrato) => {
    setEditando(c);
    setForm(doContrato(c));
    setErro(null);
  };
  const fechar = () => {
    setEditando(null);
    setErro(null);
  };

  const mudar = (parte: Partial<Formulario>) => setForm((f) => ({ ...f, ...parte }));
  const mudarNovo = (parte: Partial<ClienteNovo>) => setForm((f) => ({ ...f, novo: { ...f.novo, ...parte } }));

  // Escolher a frequência ou mudar o Início marca o dia do Início; depois o operador ajusta à mão se quiser.
  const mudarFrequencia = (frequencia: Frequencia) => setForm((f) => aplicarDiaDoInicio({ ...f, frequencia }));
  const mudarInicio = (inicio: string) => setForm((f) => aplicarDiaDoInicio({ ...f, inicio }));

  const alternarDia = (dia: number) => {
    if (form.frequencia === 'QUINZENAL') return mudar({ diasSemana: [dia] });
    mudar({ diasSemana: form.diasSemana.includes(dia) ? form.diasSemana.filter((d) => d !== dia) : [...form.diasSemana, dia].sort() });
  };

  const enviar = async (acao: () => Promise<Contrato>) => {
    setEnviando(true);
    setErro(null);
    try {
      const salvo = await acao();
      await carregar();
      recarregar(); // atualiza "contratoAtivo" dos clientes
      return salvo;
    } catch (e) {
      setErro((e as Error).message);
      return null;
    } finally {
      setEnviando(false);
    }
  };

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (editando === 'novo' && form.clienteNovo) {
      const { nome, tipo, cidade, endereco, ponto } = form.novo;
      if (![nome, tipo, cidade, endereco].every((t) => t.trim())) return setErro('Preencha nome, tipo, cidade e endereço.');
      if (!ponto) return setErro('Marque no mapa onde o cliente fica.');
    } else if (form.clienteId === null) return setErro('Escolha o cliente.');
    const entrada = paraEntrada(form);
    const salvo = await enviar(() => (editando === 'novo' ? api.criarContrato(entrada) : api.editarContrato((editando as Contrato).id, entrada)));
    if (salvo) setEditando(salvo); // mostra as próximas coletas calculadas pela API
  };

  const encerrar = async () => {
    if (editando === null || editando === 'novo') return;
    if (!window.confirm(`Encerrar o contrato de ${editando.cliente.nome}? Ele deixa de gerar coletas.`)) return;
    // O PUT revalida o corpo inteiro: manda o contrato atual (não o que estiver meio editado) com a situação nova.
    const entrada: EntradaContrato = { ...paraEntrada(doContrato(editando)), situacao: 'ENCERRADO' };
    const salvo = await enviar(() => api.editarContrato(editando.id, entrada));
    if (salvo) fechar();
  };

  const emEdicao = editando !== null && editando !== 'novo' ? editando : null;
  const usaDias = form.frequencia === 'SEMANAL' || form.frequencia === 'QUINZENAL';

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Contratos</h1>
          <p className="suave">Cada cliente tem um contrato ativo, que define quantas bombonas ele recebe e em quais dias a coleta acontece.</p>
        </div>
        <button type="button" className="botao botao--primario" onClick={abrirNovo}>
          Novo contrato
        </button>
      </div>

      <div className="contratos">
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Frequência</th>
                <th className="num">Bombonas</th>
                <th>Próxima coleta</th>
              </tr>
            </thead>
            <tbody>
              {ativos.map((c) => (
                <tr
                  key={c.id}
                  className={`linha-clicavel ${emEdicao?.id === c.id ? 'linha-clicavel--ativa' : ''}`}
                  onClick={() => abrirEdicao(c)}
                >
                  <td>
                    <button type="button" className="link-linha" onClick={() => abrirEdicao(c)}>
                      {c.cliente.nome}
                    </button>
                    <div className="suave pequeno">{c.cliente.cidade}</div>
                  </td>
                  <td>{rotuloFrequencia(c)}</td>
                  <td className="num">{c.quantidade}</td>
                  <td>{c.proximas[0] ? dataCurta(c.proximas[0]) : <span className="suave">—</span>}</td>
                </tr>
              ))}
              {ativos.length === 0 && (
                <tr>
                  <td colSpan={4} className="suave">
                    Nenhum contrato ativo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {encerrados.length > 0 && (
            <p className="suave pequeno encerrados">
              {encerrados.length} {encerrados.length === 1 ? 'contrato encerrado' : 'contratos encerrados'} (não aparecem na lista).
            </p>
          )}
        </div>

        {editando !== null && (
          <form className="contrato-form" onSubmit={salvar}>
            <h2>{emEdicao ? `Editar contrato · ${emEdicao.cliente.nome}` : 'Novo contrato'}</h2>

            {emEdicao || !form.clienteNovo ? (
              <label className="contrato-form__campo">
                <span>Cliente</span>
                {emEdicao ? (
                  <input className="campo" value={`${emEdicao.cliente.nome} (${emEdicao.cliente.cidade})`} disabled />
                ) : (
                  <select className="campo" value={form.clienteId ?? ''} onChange={(e) => mudar({ clienteId: Number(e.target.value) })}>
                    {semContrato.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome} ({c.cidade})
                      </option>
                    ))}
                  </select>
                )}
                {!emEdicao && (
                  <button type="button" className="link-acao" onClick={() => mudar({ clienteNovo: true })}>
                    cadastrar cliente novo
                  </button>
                )}
              </label>
            ) : (
              <fieldset className="contrato-form__campo cliente-novo">
                <legend>Cliente novo</legend>
                <label className="contrato-form__campo">
                  <span>Nome</span>
                  <input className="campo" maxLength={120} value={form.novo.nome} onChange={(e) => mudarNovo({ nome: e.target.value })} />
                </label>
                <label className="contrato-form__campo">
                  <span>Tipo</span>
                  <select className="campo" value={form.novo.tipo} onChange={(e) => mudarNovo({ tipo: e.target.value })}>
                    <option value="" disabled>
                      Escolha o tipo
                    </option>
                    {tipos.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="contrato-form__campo">
                  <span>Cidade</span>
                  <input className="campo" value={form.novo.cidade} onChange={(e) => mudarNovo({ cidade: e.target.value })} />
                </label>
                <label className="contrato-form__campo">
                  <span>Endereço</span>
                  <input className="campo" value={form.novo.endereco} onChange={(e) => mudarNovo({ endereco: e.target.value })} />
                </label>
                <div className="contrato-form__campo">
                  <span>Local no mapa</span>
                  {config ? (
                    <MapaPonto ponto={form.novo.ponto} patio={config.patio} aoEscolher={(ponto) => mudarNovo({ ponto })} />
                  ) : (
                    <p className="suave pequeno">Carregando o mapa…</p>
                  )}
                </div>
                {semContrato.length > 0 && (
                  <button
                    type="button"
                    className="link-acao"
                    onClick={() => mudar({ clienteNovo: false, clienteId: form.clienteId ?? semContrato[0].id })}
                  >
                    usar cliente já cadastrado
                  </button>
                )}
              </fieldset>
            )}

            <label className="contrato-form__campo">
              <span>Quantidade de bombonas</span>
              <input className="campo" type="number" min={1} step={1} value={form.quantidade} onChange={(e) => mudar({ quantidade: e.target.value })} />
            </label>

            <fieldset className="contrato-form__campo">
              <legend>Frequência</legend>
              <div className="opcoes">
                {FREQUENCIAS.map((f) => (
                  <label key={f.valor}>
                    <input type="radio" name="frequencia" checked={form.frequencia === f.valor} onChange={() => mudarFrequencia(f.valor)} /> {f.rotulo}
                  </label>
                ))}
              </div>
            </fieldset>

            {usaDias && (
              <fieldset className="contrato-form__campo">
                <legend>{form.frequencia === 'QUINZENAL' ? 'Dia da semana (um só)' : 'Dias da semana'}</legend>
                <div className="opcoes">
                  {DIAS_UTEIS.map((d) => (
                    <label key={d}>
                      <input
                        type={form.frequencia === 'QUINZENAL' ? 'radio' : 'checkbox'}
                        name="dia"
                        checked={form.diasSemana.includes(d)}
                        onChange={() => alternarDia(d)}
                      />{' '}
                      {nomeDia[d]}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {form.frequencia === 'MENSAL' && (
              <label className="contrato-form__campo">
                <span>Dia do mês</span>
                <input className="campo" type="number" min={1} max={31} step={1} value={form.diaMes} onChange={(e) => mudar({ diaMes: e.target.value })} />
              </label>
            )}

            <label className="contrato-form__campo">
              <span>Início</span>
              <input className="campo" type="date" value={form.inicio} onChange={(e) => mudarInicio(e.target.value)} />
            </label>

            <p className="suave pequeno">
              {emEdicao
                ? `Próximas coletas: ${emEdicao.proximas.length ? emEdicao.proximas.map(dataCurta).join(', ') : '—'}`
                : 'Salve para ver as próximas coletas.'}
            </p>
            {emEdicao && <p className="suave pequeno">Mudanças valem a partir do próximo dia: as coletas do dia já planejadas não mudam.</p>}

            {erro && (
              <p className="erro-form" role="alert">
                {erro}
              </p>
            )}

            <div className="contrato-form__acoes">
              <button type="submit" className="botao botao--primario" disabled={enviando}>
                Salvar
              </button>
              <button type="button" className="botao" onClick={fechar} disabled={enviando}>
                Fechar
              </button>
              {emEdicao && (
                <button type="button" className="botao botao--perigo" onClick={() => void encerrar()} disabled={enviando}>
                  Encerrar contrato
                </button>
              )}
            </div>
          </form>
        )}
      </div>
      {editando === null && erro && (
        <p className="erro-form" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
