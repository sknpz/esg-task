import type { Request, Response } from 'express';

export type Evento = { tipo: 'bombona' | 'alerta' | 'indicadores'; dados: unknown };
type Ouvinte = (evento: Evento) => void;

/** Distribui eventos para os painéis conectados via Server-Sent Events. */
export function criarHubDeEventos() {
  const ouvintes = new Set<Ouvinte>();

  const emitir = (evento: Evento) => {
    for (const ouvinte of ouvintes) ouvinte(evento);
  };

  const ouvir = (ouvinte: Ouvinte) => {
    ouvintes.add(ouvinte);
    return () => void ouvintes.delete(ouvinte);
  };

  const conectar = (req: Request, res: Response) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const parar = ouvir(({ tipo, dados }) => res.write(`event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`));
    // Comentário periódico para proxies não derrubarem a conexão ociosa.
    const batimento = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(batimento);
      parar();
    });
  };

  return { emitir, ouvir, conectar };
}

export type HubDeEventos = ReturnType<typeof criarHubDeEventos>;
