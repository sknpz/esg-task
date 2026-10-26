import crypto from 'node:crypto';
import type { Config } from './config.ts';
import { transacao, type Banco } from './db.ts';

// Dados 100% fictícios: nomes inventados, coordenadas aproximadas de Cianorte e cidades vizinhas.
const CLIENTES = [
  { nome: 'Restaurante Sabor da Terra', tipo: 'Restaurante', cidade: 'Cianorte', endereco: 'Av. Santa Catarina, 1200', lat: -23.6587, lng: -52.6071 },
  { nome: 'Pastelaria do Japonês', tipo: 'Pastelaria', cidade: 'Cianorte', endereco: 'Rua Pará, 455', lat: -23.6631, lng: -52.6012 },
  { nome: 'Lanchonete Ponto Certo', tipo: 'Lanchonete', cidade: 'Cianorte', endereco: 'Av. Brasil, 3300', lat: -23.6512, lng: -52.6119 },
  { nome: 'Churrascaria Gaúcha', tipo: 'Churrascaria', cidade: 'Cianorte', endereco: 'Av. Goiás, 870', lat: -23.6702, lng: -52.5958 },
  { nome: 'Frigorífico Vale do Ivaí', tipo: 'Indústria de alimentos', cidade: 'Cianorte', endereco: 'Rod. PR-323, km 2', lat: -23.646, lng: -52.624, raioM: 300 },
  { nome: 'Hotel Colonial', tipo: 'Hotel', cidade: 'Cianorte', endereco: 'Rua Rio Grande do Norte, 210', lat: -23.6556, lng: -52.6003 },
  { nome: 'Padaria Pão Nosso', tipo: 'Padaria', cidade: 'Cianorte', endereco: 'Rua Ceará, 1580', lat: -23.668, lng: -52.615 },
  { nome: 'Cozinha do Campus', tipo: 'Restaurante universitário', cidade: 'Cianorte', endereco: 'Av. Universitária, 400', lat: -23.6755, lng: -52.609 },
  { nome: 'Lanchonete Estação', tipo: 'Lanchonete', cidade: 'Tapejara', endereco: 'Av. Paraná, 98', lat: -23.7317, lng: -52.8736 },
  { nome: 'Pastelaria Boa Massa', tipo: 'Pastelaria', cidade: 'São Tomé', endereco: 'Rua Getúlio Vargas, 312', lat: -23.5347, lng: -52.5906 },
  { nome: 'Restaurante Beira Rio', tipo: 'Restaurante', cidade: 'Japurá', endereco: 'Av. Brasil, 1020', lat: -23.4706, lng: -52.5528 },
  { nome: 'Cozinha Industrial Bom Prato', tipo: 'Cozinha industrial', cidade: 'Jussara', endereco: 'Rua das Indústrias, 55', lat: -23.6214, lng: -52.4683, raioM: 200 },
  { nome: 'Pizzaria Forno a Lenha', tipo: 'Pizzaria', cidade: 'Indianópolis', endereco: 'Av. Rio de Janeiro, 230', lat: -23.4764, lng: -52.6986 },
  { nome: 'Lanchonete Trevo', tipo: 'Lanchonete', cidade: 'Tuneiras do Oeste', endereco: 'Rod. PR-323, trevo de acesso', lat: -23.8697, lng: -52.8761 },
];

// Índice (base 1) do cliente de cada bombona alocada.
const ALOCACOES = [1, 1, 2, 3, 4, 5, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const NO_PATIO = 5;
const EM_ROTA_PARA = [3, 7];

// Incidentes antigos para o ranking de risco (RN14).
const INCIDENTES = [
  { cliente: 2, tipo: 'EXTRAVIO', diasAtras: 110, resolucao: 'Bombona achada num ferro-velho do bairro; cliente disse que vendeu sem saber que não era dele.' },
  { cliente: 2, tipo: 'FORA_DA_AREA', diasAtras: 64, resolucao: 'Funcionário levou a bombona para casa para guardar óleo; devolvida no dia seguinte.' },
  { cliente: 2, tipo: 'EXTRAVIO', diasAtras: 21, resolucao: 'Não recuperada. Valor da reposição cobrado do cliente.' },
  { cliente: 9, tipo: 'FORA_DA_AREA', diasAtras: 40, resolucao: 'Bombona emprestada para o vizinho; recolocada no lugar.' },
  { cliente: 13, tipo: 'EXTRAVIO', diasAtras: 75, resolucao: 'Outra empresa de coleta levou por engano; recuperada.' },
];

/** Gerador pseudoaleatório determinístico, para o seed sair sempre igual. */
function aleatorio(semente: number) {
  return () => {
    semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const diasAtras = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

export function popularSeVazio(db: Banco, config: Config): boolean {
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM clientes').get() as { total: number };
  if (total > 0) return false;

  const rnd = aleatorio(42);
  // Deslocamento de até ~`metros` em volta de um ponto (1 grau de latitude ≈ 111 km).
  const perto = (lat: number, lng: number, metros: number) => ({
    lat: lat + ((rnd() - 0.5) * 2 * metros) / 111_000,
    lng: lng + ((rnd() - 0.5) * 2 * metros) / 102_000,
  });

  transacao(db, () => {
    const insCliente = db.prepare(
      'INSERT INTO clientes (nome, tipo, cidade, endereco, lat, lng, raio_m) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const c of CLIENTES) insCliente.run(c.nome, c.tipo, c.cidade, c.endereco, c.lat, c.lng, c.raioM ?? 150);

    const insDispositivo = db.prepare(
      'INSERT INTO dispositivos (id, token, modelo, bateria, ultimo_sinal, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const insBombona = db.prepare(
      'INSERT INTO bombonas (codigo, capacidade_l, status, cliente_id, dispositivo_id, atualizado_em) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insMov = db.prepare(
      'INSERT INTO movimentacoes (bombona_id, tipo, cliente_id, observacao, criado_em) VALUES (?, ?, ?, ?, ?)',
    );

    const agora = new Date().toISOString();
    const plano = [
      ...ALOCACOES.map((cliente) => ({ status: 'EM_CLIENTE', cliente })),
      ...Array.from({ length: NO_PATIO }, () => ({ status: 'PATIO', cliente: null })),
      ...EM_ROTA_PARA.map((cliente) => ({ status: 'EM_ROTA', cliente })),
    ];

    plano.forEach((item, i) => {
      const codigo = `BO-${String(i + 1).padStart(4, '0')}`;
      const dispositivo = `DEV-${String(i + 1).padStart(4, '0')}`;
      const cliente = item.cliente ? CLIENTES[item.cliente - 1] : null;
      const capacidade = cliente?.tipo === 'Indústria de alimentos' ? 200 : 50;
      // Bombona em rota acabou de sair do pátio.
      const base = item.status === 'EM_CLIENTE' && cliente ? cliente : config.patio;
      const pos = perto(base.lat, base.lng, item.status === 'EM_ROTA' ? 400 : 25);
      // Uma bombona começa com a bateria no limite, para mostrar o alerta logo de cara.
      const bateria = i === 6 ? 21 : Math.round(45 + rnd() * 55);

      insDispositivo.run(dispositivo, crypto.randomBytes(16).toString('hex'), 'Rastreador genérico (simulado)', bateria, agora, pos.lat, pos.lng);
      const { lastInsertRowid } = insBombona.run(codigo, capacidade, item.status, item.cliente, dispositivo, agora);
      const bombonaId = Number(lastInsertRowid);

      if (item.status === 'EM_CLIENTE') {
        insMov.run(bombonaId, 'SAIDA_PARA_ENTREGA', item.cliente, null, diasAtras(3 + (i % 9) + 0.1));
        insMov.run(bombonaId, 'ENTREGA_CONCLUIDA', item.cliente, null, diasAtras(3 + (i % 9)));
      } else if (item.status === 'EM_ROTA') {
        insMov.run(bombonaId, 'SAIDA_PARA_ENTREGA', item.cliente, null, agora);
      }
    });

    const insAlerta = db.prepare(`
      INSERT INTO alertas (bombona_id, cliente_id, tipo, severidade, mensagem, status, aberto_em, resolvido_em, resolvido_por, resolucao)
      VALUES (?, ?, ?, ?, ?, 'RESOLVIDO', ?, ?, 'OPERADOR', ?)`);
    for (const inc of INCIDENTES) {
      const bombonaId = ALOCACOES.indexOf(inc.cliente) + 1;
      const aberto = diasAtras(inc.diasAtras);
      const resolvido = diasAtras(inc.diasAtras - 1);
      // Todo extravio começa como uma saída da cerca.
      insAlerta.run(bombonaId, inc.cliente, 'FORA_DA_AREA', 'AVISO', 'Bombona saiu da cerca do cliente', aberto, resolvido, inc.resolucao);
      if (inc.tipo === 'EXTRAVIO') {
        insAlerta.run(bombonaId, inc.cliente, 'EXTRAVIO', 'CRITICO', 'Bombona a mais de 2 km do local esperado', aberto, resolvido, inc.resolucao);
      }
    }
  });
  return true;
}
