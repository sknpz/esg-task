import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { caiNaData, proximasColetas, proximoDiaOperacao, validarRegra, type RegraContrato } from '../src/calendario.ts';

const r = (x: Partial<RegraContrato>): RegraContrato => ({ frequencia: 'DIARIA', diasSemana: [], diaMes: null, inicio: '2026-11-02', ...x });

describe('calendário de coletas', () => {
  it('diária cai de segunda a sábado, nunca no domingo', () => {
    assert.equal(caiNaData(r({}), '2026-11-09'), true);   // seg
    assert.equal(caiNaData(r({}), '2026-11-14'), true);   // sáb
    assert.equal(caiNaData(r({}), '2026-11-15'), false);  // dom
  });
  it('nada cai antes do início', () => assert.equal(caiNaData(r({ inicio: '2026-11-10' }), '2026-11-09'), false));
  it('semanal cai nos dias marcados', () => {
    const s = r({ frequencia: 'SEMANAL', diasSemana: [1, 3, 5] });
    assert.deepEqual(proximasColetas(s, '2026-11-09', 4), ['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16']);
  });
  it('quinzenal conta 14 dias a partir da primeira ocorrência depois do início', () => {
    const q = r({ frequencia: 'QUINZENAL', diasSemana: [4], inicio: '2026-11-03' }); // 1ª quinta: 05/11
    assert.deepEqual(proximasColetas(q, '2026-11-01', 3), ['2026-11-05', '2026-11-19', '2026-12-03']);
  });
  it('mensal no dia 31 cai no último dia do mês', () => {
    const m = r({ frequencia: 'MENSAL', diaMes: 31 });
    assert.deepEqual(proximasColetas(m, '2026-11-01', 2), ['2026-11-30', '2026-12-31']);
  });
  it('mensal que cai no domingo passa para a segunda', () => {
    const m = r({ frequencia: 'MENSAL', diaMes: 15 });          // 15/11/2026 é domingo
    assert.equal(caiNaData(m, '2026-11-15'), false);
    assert.equal(caiNaData(m, '2026-11-16'), true);
  });
  it('mensal que vira segunda no mês seguinte ainda cai', () => {
    const m = r({ frequencia: 'MENSAL', diaMes: 31, inicio: '2026-01-01' }); // 31/05/2026 é domingo
    assert.equal(caiNaData(m, '2026-06-01'), true);
  });
  it('proximoDiaOperacao pula o domingo', () => assert.equal(proximoDiaOperacao('2026-11-14'), '2026-11-16'));
  it('proximasColetas termina quando a regra nunca mais cai', () => {
    const m = r({ frequencia: 'SEMANAL', diasSemana: [1] });
    assert.deepEqual(proximasColetas({ ...m, inicio: '2026-11-02' }, '2026-11-09', 0), []);
  });
  it('validarRegra recusa regra incoerente', () => {
    for (const ruim of [{ frequencia: 'SEMANAL', diasSemana: [] }, { frequencia: 'SEMANAL', diasSemana: [0] },
                        { frequencia: 'QUINZENAL', diasSemana: [1, 2] }, { frequencia: 'MENSAL', diaMes: 32 },
                        { frequencia: 'ANUAL' }, { frequencia: 'DIARIA', inicio: '09/11/2026' }])
      assert.throws(() => validarRegra({ diasSemana: [], diaMes: null, inicio: '2026-11-09', ...ruim }));
  });
  it('validarRegra normaliza', () => {
    assert.deepEqual(validarRegra({ frequencia: 'SEMANAL', diasSemana: [5, 1, 5], diaMes: 7, inicio: '2026-11-09' }),
      { frequencia: 'SEMANAL', diasSemana: [1, 5], diaMes: null, inicio: '2026-11-09' });
    assert.deepEqual(validarRegra({ frequencia: 'MENSAL', diasSemana: [2], diaMes: 10, inicio: '2026-11-09' }),
      { frequencia: 'MENSAL', diasSemana: [], diaMes: 10, inicio: '2026-11-09' });
    assert.throws(() => validarRegra({ frequencia: 'DIARIA', diasSemana: [], diaMes: null, inicio: '2026-02-30' }));
  });
});
