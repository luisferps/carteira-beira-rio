import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { _teste } from '../netlify/functions/locacao-lib.mjs';

new Function(fs.readFileSync(new URL('../public/ferramentas/le-acerto-mensal.js', import.meta.url), 'utf8'))();
const L = globalThis.LeAcerto;

test('vencimento dia 30/31 não pula fevereiro', () => {
  assert.equal(_teste.vencDe('2026-02', 30), '2026-02-28');
  assert.equal(_teste.vencDe('2028-02', 31), '2028-02-29');
  assert.equal(_teste.vencDe('2026-03', 30), '2026-03-30');
  assert.equal(_teste.addMeses('2025-01-31', 1), '2025-02-28');
});

test('planilha Acerto Mensal: meses, saldo que passa e repasse', () => {
  const rows = [
    [null, null, 'IMÓVEL TESTE 101'],
    [null, null, 'Março-2025'],
    [null, null, 'Aluguel', 1000], [null, null, 'Administração Imobiliária', -100], [null, null, 'Condomínio 03/2025', -300],
    [null, null, 'À RECEBER:', 600],
    [null, null, 'IMÓVEL TESTE 101'],
    [null, null, 'Abril - 2025'],
    [null, null, 'Enel - 04/2025', -50],
    [null, null, 'À PAGAR', -50],
    [null, null, 'Maio - 2025'],
    [null, null, 'Acumulado do mês anterior', -50], [null, null, 'Aluguel', 1000], [null, null, 'Administração Imobiliária', -100],
    [null, null, 'À RECEBER:', 850],
  ];
  const lido = L.leLinhas(rows);
  assert.equal(lido.titulo, 'IMÓVEL TESTE 101');
  assert.deepEqual(lido.blocos.map(b => b.competencia), ['2025-03', '2025-04', '2025-05']);
  const p = L.preparaImportacao(lido, false);
  assert.deepEqual(p.meses.map(m => m.confere), [true, true, true]);
  assert.equal(p.meses[0].repasse, 600);          /* março foi repassado */
  assert.equal(p.meses[1].repasse, 0);            /* abril ficou negativo e passou para maio */
  assert.equal(p.saldoFinal, 850);                /* maio ainda não repassado */
  assert.equal(L.tipoDe('Retido para condomínio 06/2019'), 'retencao');
  assert.equal(L.tipoDe('Intermediação de Nova Locação'), 'intermediacao');
  assert.equal(L.tipoDe('IPTU Garagem 2019'), 'iptu');
});

test('mês digitado com ano errado ou repetido', () => {
  const rows = [[null, 'X'], [null, 'Janeiro - 2023'], [null, 'Aluguel', 1], [null, 'Fevereiro - 2022'], [null, 'Aluguel', 1],
    [null, 'Março - 2023'], [null, 'Aluguel', 2], [null, 'Março - 2023'], [null, 'Aluguel', 2]];
  const lido = L.leLinhas(rows);
  assert.deepEqual(lido.blocos.filter(b => !b.ignorar).map(b => b.competencia), ['2023-01', '2023-02', '2023-03']);
  assert.equal(lido.blocos.filter(b => b.ignorar).length, 1);
});
