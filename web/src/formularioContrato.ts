import type { Contrato, EntradaContrato, Frequencia, Ponto } from './api.ts';

/** O cliente digitado no "Novo contrato". */
export type ClienteNovo = { nome: string; tipo: string; cidade: string; endereco: string; ponto: Ponto | null };

export type Formulario = {
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

export const vazio = (inicio: string): Formulario => ({
  clienteNovo: true,
  novo: novoVazio(),
  clienteId: null,
  quantidade: '1',
  frequencia: 'SEMANAL',
  diasSemana: [],
  diaMes: '1',
  inicio,
});

export const doContrato = (c: Contrato): Formulario => ({
  clienteNovo: false,
  novo: novoVazio(),
  clienteId: c.clienteId,
  quantidade: String(c.quantidade),
  frequencia: c.frequencia,
  diasSemana: c.diasSemana,
  diaMes: String(c.diaMes ?? 1),
  inicio: c.inicio,
});

/** Depois de salvar (criar ou editar), o formulário passa a editar o contrato salvo, com o cliente dele. */
export const formularioDepoisDeSalvar = doContrato;

/** O que falta para enviar; null quando pode enviar. `criando`: "Novo contrato" (o cliente ainda é escolhido). */
export function erroDoFormulario(f: Formulario, criando: boolean): string | null {
  if (criando && f.clienteNovo) {
    const { nome, tipo, cidade, endereco, ponto } = f.novo;
    if (![nome, tipo, cidade, endereco].every((t) => t.trim())) return 'Preencha nome, tipo, cidade e endereço.';
    if (!ponto) return 'Marque no mapa onde o cliente fica.';
    return null;
  }
  return f.clienteId === null ? 'Escolha o cliente.' : null;
}

export function paraEntrada(f: Formulario): EntradaContrato {
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
