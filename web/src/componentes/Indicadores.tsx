import { moeda, numero } from '../formato.ts';
import { useMonitoramento } from '../monitoramento.tsx';

export function Indicadores() {
  const { indicadores: ind } = useMonitoramento();
  if (!ind) return <div className="indicadores indicadores--carregando" />;
  const itens = [
    { rotulo: 'Bombonas', valor: numero(ind.total), detalhe: `${ind.porStatus.PATIO} no pátio` },
    { rotulo: 'Em clientes', valor: numero(ind.porStatus.EM_CLIENTE), detalhe: `${numero(ind.capacidadeEmCampoL)} L de capacidade` },
    { rotulo: 'Em rota', valor: numero(ind.porStatus.EM_ROTA), detalhe: 'no caminhão' },
    {
      rotulo: 'Extraviadas',
      valor: numero(ind.porStatus.EXTRAVIADA),
      detalhe: `${moeda(ind.valorEmRisco)} em risco`,
      tom: ind.porStatus.EXTRAVIADA > 0 ? 'critico' : undefined,
    },
    {
      rotulo: 'Alertas abertos',
      valor: numero(ind.alertasAbertos),
      detalhe: `${ind.alertasCriticos} críticos`,
      tom: ind.alertasCriticos > 0 ? 'critico' : ind.alertasAbertos > 0 ? 'aviso' : undefined,
    },
  ];
  return (
    <div className="indicadores">
      {itens.map((i) => (
        <div key={i.rotulo} className={`indicador ${i.tom ? `indicador--${i.tom}` : ''}`}>
          <span className="indicador__rotulo">{i.rotulo}</span>
          <strong className="indicador__valor">{i.valor}</strong>
          <span className="indicador__detalhe">{i.detalhe}</span>
        </div>
      ))}
    </div>
  );
}
