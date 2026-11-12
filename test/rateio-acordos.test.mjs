import assert from 'node:assert/strict';
import { test } from 'node:test';
import { custoRateadoNaBaixa, rateioConferido, rateiosConferidos } from '../netlify/functions/rateio-acordos-lib.mjs';

test('rateia cobrança de origem e financiamento sem atribuir juros Price à entrada', () => {
  const parcelas = [1621.44, ...Array(9).fill(1703.59)].map((valor_face, id) => ({ id, valor_face }));
  const antes = structuredClone(parcelas);
  const rateio = rateioConferido({ valor_acordado: 16214.40 }, parcelas, rateiosConferidos['0153-001']);
  assert.equal(rateio.get('0'), 142.40);
  assert.equal(Math.round([...rateio.values()].reduce((a, b) => a + b) * 100), 149794);
  assert.deepEqual(parcelas, antes);
});

test('rateia multa e juros da cobrança antiga dentro do valor original dos boletos', () => {
  const parcelas = [1035.11, 1035.11, 1035.12].map((valor_face, id) => ({ id, valor_face }));
  const regra = { atualBruta: 31053, herdado: 27141, multaHerdada: 543, jurosHerdados: 546 };
  const rateio = rateioConferido({ valor_acordado: 3105.34 }, parcelas, regra);
  assert.deepEqual([...rateio.values()], [188.20, 188.20, 188.20]);
  assert.deepEqual(parcelas.map(p => Math.round((p.valor_face - rateio.get(String(p.id))) * 100)), [84691, 84691, 84692]);
});

test('limita o rateio interno à fração da parcela que foi recebida', () => {
  assert.equal(custoRateadoNaBaixa(200, 2000, 1000), 100);
  assert.equal(custoRateadoNaBaixa(200, 2000, 2250), 200);
  assert.equal(custoRateadoNaBaixa(200, 2000, -20), 0);
});
