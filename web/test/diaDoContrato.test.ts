import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aplicarDiaDoInicio, aplicarInicioDoDia, diaDoInicio, proximaData } from '../src/diaDoContrato.ts';

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

// 2026-11-11 é quarta-feira.
test('proximaData semanal/quinzenal: a próxima data, a partir de hoje, num dos dias marcados', () => {
  assert.equal(proximaData('2026-11-11', 'SEMANAL', [4], '1'), '2026-11-12'); // quinta
  assert.equal(proximaData('2026-11-11', 'SEMANAL', [3], '1'), '2026-11-11'); // hoje mesmo
  assert.equal(proximaData('2026-11-11', 'QUINZENAL', [1], '1'), '2026-11-16'); // segunda seguinte
  assert.equal(proximaData('2026-11-11', 'SEMANAL', [1, 5], '1'), '2026-11-13'); // a mais próxima: sexta
  assert.equal(proximaData('2026-11-11', 'SEMANAL', [], '1'), null);
  assert.equal(proximaData('2026-11-28', 'SEMANAL', [1], '1'), '2026-11-30'); // vira o mês
});

test('proximaData mensal: o dia do mês neste mês ou no próximo; mês curto cai no último dia', () => {
  assert.equal(proximaData('2026-11-11', 'MENSAL', [], '20'), '2026-11-20');
  assert.equal(proximaData('2026-11-11', 'MENSAL', [], '11'), '2026-11-11');
  assert.equal(proximaData('2026-11-11', 'MENSAL', [], '5'), '2026-12-05');
  assert.equal(proximaData('2026-11-11', 'MENSAL', [], '31'), '2026-11-30');
  assert.equal(proximaData('2027-01-31', 'MENSAL', [], '30'), '2027-02-28');
  assert.equal(proximaData('2026-11-11', 'MENSAL', [], ''), null);
  assert.equal(proximaData('2026-11-11', 'MENSAL', [], '40'), null);
  assert.equal(proximaData('2026-11-11', 'DIARIA', [], '1'), null);
  assert.equal(proximaData('', 'SEMANAL', [4], '1'), null);
});

test('aplicarInicioDoDia move só o Início e mantém os dias marcados', () => {
  const f = { frequencia: 'SEMANAL' as const, inicio: '2026-11-11', diasSemana: [1, 4], diaMes: '1', quantidade: '2' };
  assert.deepEqual(aplicarInicioDoDia(f, '2026-11-11'), { ...f, inicio: '2026-11-12' });
  const semDias = { ...f, diasSemana: [] };
  assert.deepEqual(aplicarInicioDoDia(semDias, '2026-11-11'), semDias); // nada marcado: Início fica
});
