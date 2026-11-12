import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aplicarDiaDoInicio, diaDoInicio } from '../src/diaDoContrato.ts';

test('diaDoInicio: dia da semana e do mês; domingo vira segunda; data inválida é null', () => {
  assert.deepEqual(diaDoInicio('2026-11-11'), { diaSemana: 3, diaMes: 11 }); // quarta
  assert.deepEqual(diaDoInicio('2026-11-15'), { diaSemana: 1, diaMes: 15 }); // domingo → segunda
  assert.equal(diaDoInicio(''), null);
  assert.equal(diaDoInicio('2026-13-40'), null);
  assert.equal(diaDoInicio('2026-02-30'), null);
});

test('aplicarDiaDoInicio por frequência', () => {
  const base = { inicio: '2026-11-13', diasSemana: [1, 3], diaMes: '1' }; // sexta
  assert.deepEqual(aplicarDiaDoInicio({ ...base, frequencia: 'SEMANAL' as const }).diasSemana, [5]);
  assert.deepEqual(aplicarDiaDoInicio({ ...base, frequencia: 'QUINZENAL' as const }).diasSemana, [5]);
  assert.equal(aplicarDiaDoInicio({ ...base, frequencia: 'MENSAL' as const }).diaMes, '13');
  assert.deepEqual(aplicarDiaDoInicio({ ...base, frequencia: 'DIARIA' as const }), { ...base, frequencia: 'DIARIA' });
});

test('Início vazio não apaga os dias já marcados', () => {
  const f = { frequencia: 'SEMANAL' as const, inicio: '', diasSemana: [2, 4], diaMes: '7' };
  assert.deepEqual(aplicarDiaDoInicio(f), f);
});

test('aplicarDiaDoInicio preserva os outros campos do formulário', () => {
  const f = { frequencia: 'MENSAL' as const, inicio: '2026-11-20', diasSemana: [], diaMes: '1', quantidade: '3' };
  assert.equal(aplicarDiaDoInicio(f).quantidade, '3');
});
