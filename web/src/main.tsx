import 'leaflet/dist/leaflet.css';
import './estilo.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { ProvedorDeMonitoramento } from './monitoramento.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ProvedorDeMonitoramento>
        <App />
      </ProvedorDeMonitoramento>
    </BrowserRouter>
  </StrictMode>,
);
