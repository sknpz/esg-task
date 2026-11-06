import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { Avisos } from './componentes/Avisos.tsx';
import { Indicadores } from './componentes/Indicadores.tsx';
import { Player } from './componentes/Player.tsx';
import { useMonitoramento } from './monitoramento.tsx';
import { Alertas } from './paginas/Alertas.tsx';
import { Clientes } from './paginas/Clientes.tsx';
import { Coletas } from './paginas/Coletas.tsx';
import { Contratos } from './paginas/Contratos.tsx';
import { Mapa } from './paginas/Mapa.tsx';

export function App() {
  const { conectado, alertasAbertos } = useMonitoramento();
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
        <span className={`conexao ${conectado ? 'conexao--on' : ''}`} title="Atualização em tempo real">
          <span className="conexao__ponto" />
          {conectado ? 'Ao vivo' : 'Reconectando…'}
        </span>
      </header>
      <Player />
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
          <Route path="/coletas" element={<Coletas />} />
          <Route path="*" element={<Mapa />} />
        </Routes>
      </main>
      <Avisos />
    </div>
  );
}
