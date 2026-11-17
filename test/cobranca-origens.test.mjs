import assert from 'node:assert/strict';
import test from 'node:test';
import { origensCobranca, reclassificaCobranca } from '../netlify/functions/cobranca-origens.mjs';
import { aniversarioAcordo, valorReajustadoAcordo } from '../netlify/functions/reajuste-acordo.mjs';

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
  assert.deepEqual(origensCobranca(novo).map(parte => parte.centavos), [5150, 5665]);
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
  const origens = origensCobranca(terceiro, 25000);
  assert.deepEqual(origens.map(({ acordo, centavos }) => [acordo, centavos]), [
    ['1', 3750], ['2', 6250], ['3', 15000],
  ]);
});

test('transfere a multa e os juros da cobrança herdada sem aumentar o valor negociado', () => {
  const anterior = {
    id: 1, data_acordo: '2026-10-01', principal: 500, honorarios: 50,
    valor_acordado: 550, valor_face: 550, multa_atraso: 11, juros_atraso: 11,
  };
  const novo = reclassificaCobranca({ principal: 550, multa: 11, juros: 11, honorarios: 57.20, valor_acordado: 629.20 }, [anterior]);
  assert.deepEqual([novo.principal, novo.multa, novo.juros, novo.honorarios], [500, 10, 10, 109.20]);
  assert.equal(novo.valor_acordado, 629.20);
  assert.equal(novo.cobranca_origens[0].centavos, 5200);
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

test('só libera a emissão dos ciclos que já receberam correção no acordo de 36 meses', () => {
  const inicio = '2026-11-17';
  const parcelas = Array.from({length:36}, (_,i) => new Date(Date.UTC(2026,10+i,17)).toISOString().slice(0,10));
  const valores = reajustes => parcelas.map(venc => valorReajustadoAcordo(1000,venc,inicio,reajustes));
  assert.equal(valores({}).filter(p=>!p.anoPendente).length,12);
  assert.equal(valores({2027:4}).filter(p=>!p.anoPendente).length,24);
  assert.deepEqual(valores({2027:4,2028:2})[24],{valor:1060.8});
  assert.deepEqual(valores({2028:2})[24],{valor:1000,anoPendente:2027});
  assert.deepEqual(valores(null)[24],{valor:1000});
  assert.equal(aniversarioAcordo('2024-02-29',2025),'2025-02-28');
});

test('transfere a fatia corrigida da cobrança herdada ao renegociar uma parcela reajustada', () => {
  const anterior = {id:1, data_acordo:'2026-11-17', principal:900, honorarios:100,
    valor_acordado:1000, valor_face:1000, valor_atualizado:1100};
  const novo = reclassificaCobranca({principal:1100,honorarios:110,valor_acordado:1210},[anterior]);
  assert.equal(novo.cobranca_origens[0].centavos,11000);
  assert.equal(novo.honorarios,220);
  assert.equal(novo.principal+novo.honorarios,1210);
});
