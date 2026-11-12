import assert from 'node:assert/strict';
import { test } from 'node:test';
import { custoRateadoNaBaixa, rateioConferido, rateiosConferidos } from '../netlify/functions/rateio-acordos-lib.mjs';

test('rateia cobrança de origem e financiamento sem atribuir juros Price à entrada', () => {
  const parcelas = [1621.44, ...Array(9).fill(1703.59)].map((valor_face, id) => ({ id, valor_face }));
  const antes = structuredClone(parcelas);
  const rateio = rateioConferido({ valor_acordado: 16214.40 }, parcelas, rateiosConferidos['0153-001']);
  assert.equal(rateio.get('0'), 141.55);
  assert.equal(Math.round([...rateio.values()].reduce((a, b) => a + b) * 100), 148941);
  assert.deepEqual(parcelas, antes);
});

test('limita o rateio interno à fração da parcela que foi recebida', () => {
  assert.equal(custoRateadoNaBaixa(200, 2000, 1000), 100);
  assert.equal(custoRateadoNaBaixa(200, 2000, 2250), 200);
  assert.equal(custoRateadoNaBaixa(200, 2000, -20), 0);
});
