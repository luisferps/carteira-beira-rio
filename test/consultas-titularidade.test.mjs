import test from 'node:test';
import assert from 'node:assert/strict';
import { criaConsultasIA } from '../netlify/functions/consultas-ia-lib.mjs';

const anterior = { nome: 'Anísia de Souza Bomfim', cpf: '11111111111', manual: { telefone: '62911111111' } };
const atual = { nome: 'Karina Ribeiro de Moraes', cpf: '22222222222', manual: { telefone: '62922222222' } };
const contrato = { numero: '0218', quadra: '10', lote: '04', compradores: [anterior] };
function consulta({ cessao = true, cadastro = [anterior, atual] } = {}) {
  return criaConsultasIA({
    q: async (sql, params) => {
      assert.match(sql.trim(), /^select /i);
      if (sql.includes('distinct on (contrato)')) {
        assert.match(sql, /conferente='luis'/);
        assert.match(sql, /order by contrato, data desc nulls last, id desc/);
        if (sql.includes('and contrato=$1')) assert.deepEqual(params, ['0218']);
        return cessao ? [{ contrato: '0218', data: '2026-10-30', nt: atual.nome }] : [];
      }
      if (sql.includes('from carteira.contratos')) return [contrato];
      if (sql.includes('from carteira.clientes')) return cadastro;
      return [];
    },
    normNome: v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
    digF: v => String(v || '').replace(/\D/g, ''),
    fonesDoCliente: c => [c.manual?.telefone].filter(Boolean),
    clientesDoContrato: async () => [anterior],
    dividas: async () => ({}), hojeBR: () => '2026-11-07', ATIVOS_B: []
  });
}

test('cessão retorna titular atual e seus contatos, mantendo comprador original separado', async () => {
  const r = await consulta()('ver_contrato', { numero: '0218' });
  assert.equal(r.titular_atual, atual.nome);
  assert.equal(r.cessao_atual.data, '2026-10-30');
  assert.deepEqual(r.clientes.map(c => c.nome), [atual.nome]);
  assert.deepEqual(r.clientes[0].telefones, [atual.manual.telefone]);
  assert.equal(r.compradores_originais[0].nome, anterior.nome);
});

test('busca vincula cessionária ao contrato e identifica o vínculo histórico da cedente', async () => {
  const buscar = consulta();
  const [karina] = await buscar('buscar_clientes', { texto: 'Karina' });
  assert.deepEqual(karina.contratos, ['0218 (titular atual)']);
  assert.equal(karina.vinculos_contratos[0].titular_atual, true);
  const [anisia] = await buscar('buscar_clientes', { texto: 'Anisia' });
  assert.equal(anisia.vinculos_contratos[0].titular_atual, false);
  assert.equal(anisia.vinculos_contratos[0].comprador_original, true);
  assert.match(anisia.contratos[0], /titularidade transferida/);
});

test('sem cessão, comprador original continua titular e os contatos são preservados', async () => {
  const r = await consulta({ cessao: false })('ver_contrato', { numero: '0218' });
  assert.equal(r.titular_atual, anterior.nome);
  assert.equal(r.cessao_atual, null);
  assert.equal(r.clientes[0].nome, anterior.nome);
});

test('cessionária sem cadastro não recebe os contatos da cedente nem de nome parcial', async () => {
  const r = await consulta({ cadastro: [anterior, { nome: 'Karina Ribeiro de Moraes Silva', manual: { telefone: '62933333333' } }] })('ver_contrato', { numero: '0218' });
  assert.equal(r.titular_atual, atual.nome);
  assert.equal(r.clientes[0].cadastro_localizado, false);
  assert.deepEqual(r.clientes[0].telefones, []);
  assert.equal(r.clientes[0].cpf, null);
});

test('busca encontra titular da cessão mesmo quando não existe ficha de cliente', async () => {
  const [r] = await consulta({ cadastro: [anterior] })('buscar_clientes', { texto: 'Karina Ribeiro de Moraes' });
  assert.equal(r.nome, atual.nome);
  assert.equal(r.cadastro_localizado, false);
  assert.equal(r.cpf, null);
  assert.deepEqual(r.telefones, []);
  assert.equal(r.vinculos_contratos[0].numero, '0218');
  assert.equal(r.vinculos_contratos[0].titular_atual, true);
});
