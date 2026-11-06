import crypto from 'node:crypto';
import type { Config } from './config.ts';
import { transacao, type Banco } from './db.ts';

// Clientes 100% fictícios: nomes inventados, coordenadas aproximadas de Cianorte e cidades vizinhas. O pátio é o local real da empresa (config.ts).
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
  // Escala real: pontos em ruas do centro de cada cidade (o roteador precisa alcançá-los).
  { nome: 'Churrascaria Brasa Serrana', tipo: 'Churrascaria', cidade: 'Umuarama', endereco: 'Av. Paraná, 2100', lat: -23.766, lng: -53.325 },
  { nome: 'Restaurante Sabor Maringá', tipo: 'Restaurante', cidade: 'Maringá', endereco: 'Av. Brasil, 4500', lat: -23.42, lng: -51.933 },
  { nome: 'Pastelaria Calçadão', tipo: 'Pastelaria', cidade: 'Maringá', endereco: 'Av. Colombo, 1850', lat: -23.4075, lng: -51.9395 },
  { nome: 'Lanchonete Ponto da Serra', tipo: 'Lanchonete', cidade: 'Campo Mourão', endereco: 'Av. Capitão Índio Bandeira, 780', lat: -24.046, lng: -52.383 },
  { nome: 'Hotel Rio Paranapanema', tipo: 'Hotel', cidade: 'Paranavaí', endereco: 'Av. Paraná, 1330', lat: -23.073, lng: -52.465 },
  { nome: 'Pizzaria Massa Fina', tipo: 'Pizzaria', cidade: 'Cruzeiro do Oeste', endereco: 'Av. Brasil, 640', lat: -23.785, lng: -53.073 },
  { nome: 'Padaria Trigal', tipo: 'Padaria', cidade: 'Goioerê', endereco: 'Av. Goioerê, 915', lat: -24.185, lng: -53.025 },
  { nome: 'Restaurante Mesa Farta', tipo: 'Restaurante', cidade: 'Cidade Gaúcha', endereco: 'Av. Brasil, 310', lat: -23.378, lng: -52.944 },
  { nome: 'Lanchonete Esquina do Sabor', tipo: 'Lanchonete', cidade: 'Rondon', endereco: 'Rua Pernambuco, 205', lat: -23.411, lng: -52.765 },
  { nome: 'Cozinha Industrial Oeste', tipo: 'Cozinha industrial', cidade: 'Cascavel', endereco: 'Av. Brasil, 5200', lat: -24.9555, lng: -53.4552 },
  { nome: 'Churrascaria Boi Gordo', tipo: 'Churrascaria', cidade: 'Cascavel', endereco: 'Rua Paraná, 1700', lat: -24.9508, lng: -53.4605 },
  // Clientes 26 a 50 (contratos de coleta): pontos nas ruas, ajustados ao roteador (OSRM `nearest`). O 50 fica sem contrato nem bombona.
  { nome: 'Restaurante Sabor do Vale', tipo: 'Restaurante', cidade: 'Cianorte', endereco: 'Av. Maranhão, 640', lat: -23.66131, lng: -52.6067 },
  { nome: 'Pastelaria Massa Crocante', tipo: 'Pastelaria', cidade: 'Cianorte', endereco: 'Rua Abolição, 310', lat: -23.65874, lng: -52.60409 },
  { nome: 'Lanchonete Chapa Quente', tipo: 'Lanchonete', cidade: 'Cianorte', endereco: 'Av. Paraná, 1450', lat: -23.65876, lng: -52.61003 },
  { nome: 'Hotel Ipê Amarelo', tipo: 'Hotel', cidade: 'Cianorte', endereco: 'Rua XV de Novembro, 520', lat: -23.65433, lng: -52.60292 },
  { nome: 'Churrascaria Fogo de Chão Norte', tipo: 'Churrascaria', cidade: 'Cianorte', endereco: 'Av. Brasil, 2780', lat: -23.65339, lng: -52.61211 },
  { nome: 'Padaria Doce Manhã', tipo: 'Padaria', cidade: 'Cianorte', endereco: 'Av. Amazonas, 905', lat: -23.66399, lng: -52.60221 },
  { nome: 'Cozinha Industrial Prato Cheio', tipo: 'Cozinha industrial', cidade: 'Cianorte', endereco: 'Rua Curitiba, 1800', lat: -23.65063, lng: -52.60713 },
  { nome: 'Lanchonete Casa do Pastel', tipo: 'Lanchonete', cidade: 'Tapejara', endereco: 'Rua Duque de Caxias, 210', lat: -23.7317, lng: -52.87058 },
  { nome: 'Restaurante Sabor Caseiro', tipo: 'Restaurante', cidade: 'São Tomé', endereco: 'Rua Voluntários da Pátria, 180', lat: -23.53465, lng: -52.58773 },
  { nome: 'Pizzaria Quatro Estações', tipo: 'Pizzaria', cidade: 'Japurá', endereco: 'Av. Bolívar, 420', lat: -23.47054, lng: -52.55578 },
  { nome: 'Pastelaria Ponto do Sabor', tipo: 'Pastelaria', cidade: 'Jussara', endereco: 'Rua Ipiranga, 260', lat: -23.62159, lng: -52.47104 },
  { nome: 'Churrascaria Lenha Nobre', tipo: 'Churrascaria', cidade: 'Indianópolis', endereco: 'Av. Tupinambás, 350', lat: -23.4791, lng: -52.69856 },
  { nome: 'Lanchonete Boa Vista', tipo: 'Lanchonete', cidade: 'Tuneiras do Oeste', endereco: 'Rua Pernambuco, 145', lat: -23.86972, lng: -52.87897 },
  { nome: 'Restaurante Mesa Posta', tipo: 'Restaurante', cidade: 'Umuarama', endereco: 'Rua Tupi, 1020', lat: -23.76597, lng: -53.32792 },
  { nome: 'Hotel Estrela do Noroeste', tipo: 'Hotel', cidade: 'Umuarama', endereco: 'Av. Roberto Silveira, 780', lat: -23.76329, lng: -53.32497 },
  { nome: 'Pizzaria Massa Leve', tipo: 'Pizzaria', cidade: 'Maringá', endereco: 'Av. Mauá, 1240', lat: -23.42002, lng: -51.93006 },
  { nome: 'Cozinha Industrial Sabor Norte', tipo: 'Cozinha industrial', cidade: 'Maringá', endereco: 'Rua Joubert de Carvalho, 900', lat: -23.41993, lng: -51.93594 },
  { nome: 'Lanchonete Ponto Final', tipo: 'Lanchonete', cidade: 'Campo Mourão', endereco: 'Av. Jorge Walter, 640', lat: -24.04058, lng: -52.38792 },
  { nome: 'Restaurante Panela de Barro', tipo: 'Restaurante', cidade: 'Paranavaí', endereco: 'Rua Piauí, 530', lat: -23.07299, lng: -52.46792 },
  { nome: 'Padaria Pão de Ouro', tipo: 'Padaria', cidade: 'Cruzeiro do Oeste', endereco: 'Av. Clotilde Proma, 400', lat: -23.78498, lng: -53.07012 },
  { nome: 'Pastelaria Dois Irmãos', tipo: 'Pastelaria', cidade: 'Goioerê', endereco: 'Rua José Bonifácio, 275', lat: -24.18227, lng: -53.02508 },
  { nome: 'Restaurante Panela Cheia', tipo: 'Restaurante', cidade: 'Cidade Gaúcha', endereco: 'Alameda Brasil, 150', lat: -23.38076, lng: -52.94405 },
  { nome: 'Lanchonete Esquina Doce', tipo: 'Lanchonete', cidade: 'Rondon', endereco: 'Rua Amazonas, 330', lat: -23.41115, lng: -52.76178 },
  { nome: 'Churrascaria Estância Oeste', tipo: 'Churrascaria', cidade: 'Cascavel', endereco: 'Rua Duque de Caxias, 1120', lat: -24.9582, lng: -53.45523 },
  { nome: 'Restaurante Cantinho da Praça', tipo: 'Restaurante', cidade: 'Cianorte', endereco: 'Rua Juiz de Fora, 95', lat: -23.65875, lng: -52.59815 },
];

// Índice (base 1) do cliente de cada bombona alocada.
const ALOCACOES = [1, 1, 2, 3, 4, 5, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
// Uma bombona para cada cliente da escala real (clientes 15 a 25).
const ALOCACOES_REGIAO = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
const NO_PATIO = 5;
const EM_ROTA_PARA = [3, 7];
// Bombonas novas (BO-0036 em diante) dos clientes 26 a 49; o 50 não tem nenhuma.
const BOMBONAS_NOVAS = [2, 1, 2, 1, 3, 1, 2, 1, 2, 1, 1, 2, 1, 1, 2, 1, 3, 1, 2, 1, 1, 2, 1, 1];
const NO_PATIO_EXTRA = 30;
const INICIO_CONTRATOS = '2026-11-02';
// Contrato dos clientes 1 a 49, na ordem: D = diária; S + dias (1 = segunda … 6 = sábado); Q + dia; M + dia do mês.
const CONTRATOS = [
  'D', 'D', 'D', 'S1', 'S24', 'D', 'S36', 'S2', 'M9', 'Q3', 'M12', 'S5', 'S5', 'M16',
  'S4', 'M20', 'Q5', 'M21', 'S6', 'Q2', 'S15', 'S24', 'Q4', 'S36', 'S12',
  'D', 'D', 'S135', 'S1', 'S246', 'D', 'S36', 'S4', 'M19', 'Q1', 'M11', 'S5', 'S2', 'Q6',
  'M9', 'Q4', 'M12', 'M17', 'S3', 'M20', 'S6', 'M21', 'S25', 'S3',
];

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
    const insColeta = db.prepare(
      "INSERT INTO movimentacoes (bombona_id, tipo, cliente_id, litros, criado_em) VALUES (?, 'COLETA', ?, ?, ?)",
    );

    const agora = new Date().toISOString();
    const plano = [
      ...ALOCACOES.map((cliente) => ({ status: 'EM_CLIENTE', cliente })),
      ...Array.from({ length: NO_PATIO }, () => ({ status: 'PATIO', cliente: null })),
      ...EM_ROTA_PARA.map((cliente) => ({ status: 'EM_ROTA', cliente })),
      ...ALOCACOES_REGIAO.map((cliente) => ({ status: 'EM_CLIENTE', cliente })),
    ];

    const inserirBombona = (item: { status: string; cliente: number | null }, i: number) => {
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
    };
    plano.forEach(inserirBombona);

    // Histórico de coletas: de 3 a 6 por cliente, uma por semana, começando 15 dias atrás.
    // Litros em torno de uma média de 55% a 85% da capacidade, com ±15%; nunca acima da capacidade
    // nem abaixo de 50% da média (o seed não pode disparar a RN18).
    const capacidadeDe = db.prepare('SELECT id, capacidade_l FROM bombonas WHERE cliente_id = ? AND status = ? ORDER BY id LIMIT 1');
    const historico = (k: number) => {
      const bombona = capacidadeDe.get(k, 'EM_CLIENTE') as { id: number; capacidade_l: number } | undefined;
      if (!bombona) return;
      const media = bombona.capacidade_l * (0.55 + 0.3 * rnd());
      for (let n = 0; n < 3 + (k % 4); n++) {
        const litros = Math.min(bombona.capacidade_l, Math.max(1, Math.round(media * (0.85 + 0.3 * rnd()))));
        insColeta.run(bombona.id, k, litros, diasAtras(15 + 7 * n));
      }
    };
    for (let k = 1; k <= 25; k++) historico(k);

    // Tudo que veio com os contratos de coleta entra depois, para os valores sorteados acima não mudarem:
    // bombonas dos clientes 26 a 49 (com o mesmo padrão de histórico de litros) e o estoque extra do pátio (RN24).
    const novas = [
      ...BOMBONAS_NOVAS.flatMap((qtd, j) => Array.from({ length: qtd }, () => ({ status: 'EM_CLIENTE', cliente: 26 + j }))),
      ...Array.from({ length: NO_PATIO_EXTRA }, () => ({ status: 'PATIO', cliente: null })),
    ];
    novas.forEach((item, j) => inserirBombona(item, plano.length + j));
    for (let k = 26; k <= 25 + BOMBONAS_NOVAS.length; k++) historico(k);

    // Um contrato ativo para os clientes 1 a 49, com a quantidade igual às bombonas que o cliente tem (ou recebe).
    const insContrato = db.prepare(
      `INSERT INTO contratos (cliente_id, quantidade, frequencia, dias_semana, dia_mes, inicio, situacao, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, 'ATIVO', ?, ?)`,
    );
    const qtdDe = db.prepare('SELECT COUNT(*) AS n FROM bombonas WHERE cliente_id = ?');
    CONTRATOS.forEach((regra, j) => {
      const k = j + 1;
      const { n } = qtdDe.get(k) as { n: number };
      const dado = Number(regra.slice(1));
      const frequencia = ({ D: 'DIARIA', S: 'SEMANAL', Q: 'QUINZENAL', M: 'MENSAL' } as Record<string, string>)[regra[0]];
      const dias = regra[0] === 'S' ? regra.slice(1).split('').join(',') : regra[0] === 'Q' ? String(dado) : '';
      insContrato.run(k, n, frequencia, dias, regra[0] === 'M' ? dado : null, INICIO_CONTRATOS, agora, agora);
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
