import { useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { Avisos } from './componentes/Avisos.tsx';
import { Indicadores } from './componentes/Indicadores.tsx';
import { api } from './api.ts';
import { formatarDataOperacao } from './formato.ts';
import { useMonitoramento } from './monitoramento.tsx';
import { Alertas } from './paginas/Alertas.tsx';
import { Clientes } from './paginas/Clientes.tsx';
import { Contratos } from './paginas/Contratos.tsx';
import { Mapa } from './paginas/Mapa.tsx';

export function App() {
  const { conectado, alertasAbertos, operacao } = useMonitoramento();
  const [alternando, setAlternando] = useState(false);
  const alternarPausa = async () => {
    if (!operacao) return;
    setAlternando(true);
    try {
      await (operacao.pausado ? api.continuar() : api.pausar()); // o estado novo chega pelo evento 'operacao'
    } catch {
      /* sem resposta: o botão volta e o operador tenta de novo */
    } finally {
      setAlternando(false);
    }
  };
  return (
    <div className="app">
      <header className="topo">
        <Link to="/" className="marca">
          <img src="/bombona.svg" alt="" width={26} height={26} />
          <span>
            <strong>Bio Óleo</strong>
            <small>Rastreio de bombonas</small>
          </span>
        </Link>
        <nav className="navegacao">
          <NavLink to="/" end>
            Mapa
          </NavLink>
          <NavLink to="/coletas">Coletas do dia</NavLink>
          <NavLink to="/alertas">
            Alertas
            {alertasAbertos.length > 0 && <span className="contador">{alertasAbertos.length}</span>}
          </NavLink>
          <NavLink to="/clientes">Clientes</NavLink>
          <NavLink to="/contratos">Contratos</NavLink>
        </nav>
        {operacao && (
          <div className="operacao" title="Data simulada da operação">
            <span className="operacao__data">{formatarDataOperacao(operacao.data)}</span>
            <button type="button" className="botao botao--pequeno" onClick={() => void alternarPausa()} disabled={alternando}>
              {operacao.pausado ? 'Continuar' : 'Pausar'}
            </button>
          </div>
        )}
        <span className={`conexao ${conectado ? 'conexao--on' : ''}`} title="Atualização em tempo real">
          <span className="conexao__ponto" />
          {conectado ? 'Ao vivo' : 'Reconectando…'}
        </span>
      </header>
      <div className="aviso-prototipo">
        Protótipo hipotético: clientes, dados e rastreadores são <strong>simulados</strong>.
      </div>
      <Indicadores />
      <main className="conteudo">
        <Routes>
          <Route path="/" element={<Mapa />} />
          <Route path="/alertas" element={<Alertas />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/contratos" element={<Contratos />} />
          {/* Provisório: a Task 9 troca isto pela página de Coletas do dia. */}
          <Route path="/coletas" element={<div className="pagina">Coletas do dia em construção.</div>} />
          <Route path="*" element={<Mapa />} />
        </Routes>
      </main>
      <Avisos />
    </div>
  );
}
