import test from 'node:test';
import assert from 'node:assert/strict';
import {validaCompraVenda} from '../public/ferramentas/compra-dados.mjs';
import {dadosMinuta, qualifica} from '../public/ferramentas/compra-minuta.mjs';

function comprador(i) {
  const base = String(102030400 + i);
  const dv = b => [...b].reduce((s,d,j) => s + Number(d)*(b.length+1-j),0) * 10 % 11 % 10;
  const dez = base + dv(base);
  const p = {nome:'Comprador Fictício '+i, cpf:dez+dv(dez), rg:'FICTÍCIO '+i, estado_civil:'Solteiro',
    profissao:'Professor', nacionalidade:'Brasileira', endereco:'Rua de Teste, 101', fone:'(62) 99999-9999'};
  return {...p, qualificacao:qualifica(p)};
}
const compra = {
  numero:'9999',quadra:'5',lote:'11b',rua:'Alameda de Testes',area:1200.50,matricula:'999',
  cartorio:'Registro Fictício',cidade:'Goiânia',data_assinatura:'2026-11-16',
  corretor:'CRECI fictício',corretagem:1200,pagamento_corretagem:'Conforme ajuste entre as partes',
  valor_imovel:12900,compradores:[1,2,3,4].map(comprador),
  itens:[
    {tipo:'entrada',qtd:1,valor:9900,primeiro_venc:'2026-11-16',forma:'pix_pago',data_pagamento:'2026-11-14'},
    {tipo:'entrada',qtd:1,valor:1000,primeiro_venc:'2026-12-16',forma:'boleto'},
    {tipo:'mensal',qtd:2,valor:1000,primeiro_venc:'2027-01-16'},
  ],
};

test('distingue entrada paga, entrada com boleto e parcelas futuras, preservando o preço', () => {
  const b = validaCompraVenda(compra);
  assert.deepEqual(b.itens.map(p => [p.pago,p.emitir]), [[true,false],[false,true],[false,false]]);
  assert.equal(b.entrada_total,10900);
  assert.equal(b.valor_imovel,12900);
  assert.equal(b.lote,'11B');
  assert.throws(() => validaCompraVenda({...compra,valor_imovel:12899.99}), /soma/);
  assert.throws(() => validaCompraVenda({...compra,compradores:[...compra.compradores,comprador(5)]}), /quatro/);
  assert.throws(() => validaCompraVenda({...compra,compradores:[{...comprador(0),estado_civil:''}]}), /estado civil/);
});

test('prepara as condições e os quatro compradores para a minuta', () => {
  const dados = dadosMinuta(validaCompraVenda(compra), new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format, z=>''+z);
  assert.equal(dados.numero,'9999');
  assert.match(dados.condicoes_entrada,/já paga em 14\/11\/2026 \(Pix\)/);
  assert.match(dados.condicoes_entrada,/com vencimento em 16\/12\/2026/);
  assert.match(dados.condicoes_saldo,/com primeiro vencimento em 16\/01\/2027/);
  assert.deepEqual(dados.assinaturas.map(p => p.nome), [1,2,3,4].map(i => 'COMPRADOR FICTÍCIO '+i));
});
