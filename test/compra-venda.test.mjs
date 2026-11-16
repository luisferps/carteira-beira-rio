import test from 'node:test';
import assert from 'node:assert/strict';
import {comissaoPadrao, somaParcelasCentavos, totalRedondo, validaCompraVenda} from '../public/ferramentas/compra-dados.mjs';
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
  corretor:'Corretor fictício',creci_corretor:'12345-F',corretagem:1200,pagamento_corretagem:'Conforme ajuste entre as partes',
  valor_imovel:12900,compradores:[1,2,3,4].map(comprador),
  itens:[
    {tipo:'entrada',qtd:1,valor:9900,primeiro_venc:'2026-11-16',forma:'pix_pago',data_pagamento:'2026-11-14',recebedor:'FCA'},
    {tipo:'entrada',qtd:1,valor:1000,primeiro_venc:'2026-12-16',forma:'boleto',recebedor:'Vendedora'},
    {tipo:'mensal',qtd:2,valor:1000,primeiro_venc:'2027-01-16'},
  ],
};

test('distingue entrada paga, entrada com boleto e parcelas futuras, preservando o preço', () => {
  const b = validaCompraVenda(compra);
  assert.deepEqual(b.itens.map(p => [p.pago,p.emitir]), [[true,false],[false,true],[false,false]]);
  assert.equal(b.entrada_total,10900);
  assert.equal(b.valor_imovel,12900);
  assert.equal(b.corretagem,645);
  assert.deepEqual(b.itens.map(p => p.recebedor), ['FCA','Vendedora',undefined]);
  assert.equal(b.lote,'11B');
  assert.throws(() => validaCompraVenda({...compra,valor_imovel:12899.99}), /soma/);
  assert.throws(() => validaCompraVenda({...compra,compradores:[...compra.compradores,comprador(5)]}), /quatro/);
  assert.throws(() => validaCompraVenda({...compra,compradores:[{...comprador(0),estado_civil:''}]}), /estado civil/);
  assert.throws(() => validaCompraVenda({...compra,itens:[{...compra.itens[0],recebedor:''},...compra.itens.slice(1)]}), /quem recebe/);
});

test('prepara as condições e os quatro compradores para a minuta', () => {
  const dados = dadosMinuta(validaCompraVenda(compra), new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format, z=>''+z);
  assert.equal(dados.numero,'9999');
  assert.match(dados.condicoes_entrada,/já paga em 14\/11\/2026 \(Pix\)/);
  assert.match(dados.condicoes_entrada,/a favor de FCA/);
  assert.match(dados.condicoes_entrada,/com vencimento em 16\/12\/2026/);
  assert.match(dados.condicoes_saldo,/com primeiro vencimento em 16\/01\/2027/);
  assert.equal(dados.corretor,'Corretor fictício, CRECI nº 12345-F');
  assert.deepEqual(dados.assinaturas.map(p => p.nome), [1,2,3,4].map(i => 'COMPRADOR FICTÍCIO '+i));
});

test('sugere 5% do preço da venda e ajusta um centavo na última anual', () => {
  const itens = [
    compra.itens[0],
    {...compra.itens[1],valor:5000,forma:'direto'},
    {...compra.itens[2],qtd:100,valor:1192},
    {tipo:'anual',qtd:7,valor:2128.57,primeiro_venc:'2027-11-16'},
  ];
  assert.equal(somaParcelasCentavos(itens),14899999);
  assert.equal(totalRedondo(somaParcelasCentavos(itens)),14900000);
  const venda = {...compra,itens,valor_imovel:149000,corretor:'Júnior',corretagem:comissaoPadrao(149000)};
  const b = validaCompraVenda(venda);
  assert.equal(b.corretagem,7450);
  assert.deepEqual(b.itens.map(p => p.ajuste_ultima_centavos), [undefined,undefined,undefined,1]);
  assert.equal(b.itens[0].valor,9900);
  assert.equal(b.itens[1].emitir,false);
  const dados = dadosMinuta(b, v => v.toFixed(2), String);
  assert.equal(dados.corretor,'Júnior, CRECI nº 12345-F');
  assert.match(dados.condicoes_saldo,/6 primeiras de 2128\.57 .* e a última de 2128\.58/);
  assert.throws(() => validaCompraVenda({...venda,valor_imovel:149001}), /soma/);
  assert.throws(() => validaCompraVenda({...venda,itens:[{...itens[0],valor:9899.99}],valor_imovel:9900}), /soma/);
});

test('fixa cidade e comissão, e aplica os padrões de registro e pagamento da comissão', () => {
  const b = validaCompraVenda({...compra, cidade:'Outra cidade', corretagem:0, matricula:'', cartorio:'', pagamento_corretagem:''});
  assert.equal(b.cidade,'Goiânia');
  assert.equal(b.corretagem,645);
  assert.equal(b.matricula,'Livro de Registro Geral 2 nº 2.996');
  assert.match(b.cartorio,/1º Registro do Município de Varjão/);
  assert.equal(b.pagamento_corretagem,'à vista');
  assert.equal(validaCompraVenda(compra).matricula,'999');
  assert.equal(validaCompraVenda(compra).cartorio,'Registro Fictício');
  assert.throws(() => validaCompraVenda({...compra,creci_corretor:''}), /CRECI/);
});
