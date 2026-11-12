import assert from 'node:assert/strict';
import test from 'node:test';
import { cobrancaRecebida, reclassificaCobranca } from '../netlify/functions/cobranca-origens.mjs';

test('nova cobrança incide sobre a parcela inteira e preserva apenas a parte antiga em aberto', () => {
  const anterior = {
    id: 1, data_acordo: '2026-10-01', principal: 1000, multa: 20, juros: 10,
    honorarios: 103, valor_acordado: 1133, valor_face: 566.50,
  };
  const novo = reclassificaCobranca(
    { id: 2, data_acordo: '2026-11-12', principal: 566.50, honorarios: 56.65, valor_acordado: 623.15 },
    [anterior],
  );
  assert.equal(novo.principal, 515);
  assert.equal(novo.honorarios, 108.15);
  const recebimento = { ...novo, honorarios_pago: 108.15, soma_parcelas: 623.15, valor_face: 623.15 };
  assert.deepEqual(cobrancaRecebida(recebimento).map(parte => parte.centavos), [5150, 5665]);
});

test('preserva cada custo de cobrança quando o saldo passa por três acordos', () => {
  const primeiro = { id: 1, data_acordo: '2025-05-22', principal: 4000, honorarios: 400, valor_acordado: 4400 };
  const segundo = reclassificaCobranca(
    { id: 2, data_acordo: '2026-04-02', principal: 5000, honorarios: 500, valor_acordado: 5500 },
    [{ ...primeiro, valor_face: 3300 }],
  );
  const terceiro = reclassificaCobranca(
    { id: 3, data_acordo: '2026-11-12', principal: 6000, honorarios: 600, valor_acordado: 6600 },
    [{ ...segundo, valor_face: 2750 }],
  );
  assert.equal(terceiro.principal + terceiro.honorarios, 6600);
  const origens = cobrancaRecebida({ ...terceiro, honorarios_pago: 250, soma_parcelas: 6600, valor_face: 1650 });
  assert.deepEqual(origens.map(({ acordo, centavos }) => [acordo, centavos]), [
    ['1', 3750], ['2', 6250], ['3', 15000],
  ]);
});

test('recupera apenas custo explícito de acordo antigo e mantém o valor acordado', () => {
  const anterior = { id: 2, data_acordo: '2026-04-02', principal: 34185.20, multa: 280.24, juros: 755.43, honorarios: 1529.13, valor_acordado: 36750 };
  const parcelas = [7000, 15750].map(valor_face => ({ ...anterior, valor_face }));
  const dados = { principal: 33660.99, honorarios: 3579.89, valor_acordado: 39378.76 };
  const resultado = reclassificaCobranca(dados, parcelas);
  assert.equal(resultado.cobranca_origens[0].centavos, 94660);
  assert.equal(resultado.honorarios, 4526.49);
  assert.equal(resultado.principal, 32714.39);
  assert.equal(resultado.valor_acordado, dados.valor_acordado);
  const semComposicao = reclassificaCobranca(dados, [{ ...anterior, honorarios: 0, valor_face: 7000 }]);
  assert.deepEqual(semComposicao, { ...dados, cobranca_origens: [] });
});
