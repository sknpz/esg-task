import type { Cliente, Frequencia } from './api.ts';

/** Ordem pela quantidade de bombonas; null mantém a ordem do servidor (incidentes, nome). */
export type OrdemBombonas = 'DESC' | 'ASC' | null;

/** Recorte da lista de Clientes. Lista vazia num grupo = sem filtro nele; 'SEM' = sem contrato ativo. */
export type FiltroClientes = {
  busca: string;
  riscos: Cliente['risco'][];
  modalidades: Array<Frequencia | 'SEM'>;
  ordem: OrdemBombonas;
};

/** Texto para comparar: sem espaços nas pontas, minúsculo e sem acentos. */
export function normalizar(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/** Pesquisa em nome, cidade e endereço; OU dentro de cada grupo de filtro, E entre grupos; ordenação estável. */
export function filtrarClientes(clientes: Cliente[], f: FiltroClientes): Cliente[] {
  const busca = normalizar(f.busca);
  const lista = clientes.filter(
    (c) =>
      (busca === '' || [c.nome, c.cidade, c.endereco].some((campo) => normalizar(campo).includes(busca))) &&
      (f.riscos.length === 0 || f.riscos.includes(c.risco)) &&
      (f.modalidades.length === 0 || f.modalidades.includes(c.modalidade ?? 'SEM')),
  );
  if (f.ordem === null) return lista;
  const sinal = f.ordem === 'DESC' ? -1 : 1;
  return lista.sort((a, b) => sinal * (a.bombonas - b.bombonas));
}

/** Clique no cabeçalho "Bombonas": decrescente → crescente → ordem original. */
export function proximaOrdem(o: OrdemBombonas): OrdemBombonas {
  return o === null ? 'DESC' : o === 'DESC' ? 'ASC' : null;
}
