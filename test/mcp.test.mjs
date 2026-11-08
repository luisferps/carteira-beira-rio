import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { criaHandlerMcp } from '../netlify/lib/mcp.mjs';
import { criaConsultasIA } from '../netlify/functions/consultas-ia-lib.mjs';

const token = 'somente-para-teste-local-nao-e-credencial';
const url = 'https://carteira.example/mcp';
const req = (method = 'POST', headers = {}, body) => new Request(url, {
  method, headers: { Authorization: `Bearer ${token}`, ...headers }, ...(body === undefined ? {} : { body })
});

test('bloqueia acesso sem configuração, token incorreto, origem cruzada e métodos sem consultar dados', async () => {
  let chamadas = 0;
  const consulta = async () => { chamadas++; };
  const handler = criaHandlerMcp({ consulta, env: () => token });
  assert.equal((await criaHandlerMcp({ consulta, env: () => undefined })(req())).status, 503);
  assert.equal((await criaHandlerMcp({ consulta, env: () => 'curto' })(req())).status, 503);
  assert.equal((await handler(req('POST', { Authorization: '' }))).status, 401);
  assert.equal((await handler(req('POST', { Authorization: `Bearer ${'x'.repeat(token.length)}` }))).status, 401);
  assert.equal((await handler(req('POST', { Origin: 'https://estranho.example' }))).status, 403);
  for (const method of ['GET', 'DELETE', 'OPTIONS']) assert.equal((await handler(req(method))).status, 405);
  assert.equal(chamadas, 0);
});

test('cliente oficial conecta, lista ferramentas, consulta, pagina e rejeita parâmetros inválidos', async () => {
  const chamadas = [], logs = [];
  const consulta = async (nome, ent) => {
    chamadas.push([nome, ent]);
    if (nome === 'buscar_clientes') return [{ nome: 'Cliente de teste', contratos: ['0042'] }];
    if (nome === 'ver_contrato') return { contrato: ent.numero, em_atraso: { total: 123.45 } };
    return [
      { contrato: '0042', etapa: 'fila', divida: 6000 },
      { contrato: '0043', etapa: 'promessa', divida: 7000 },
      { contrato: '0044', etapa: 'fila', divida: 8000 }
    ];
  };
  const handler = criaHandlerMcp({ consulta, env: () => token, registra: t => logs.push(t) });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: (u, init) => handler(new Request(u, init))
  });
  const client = new Client({ name: 'teste-codex', version: '1.0.0' });
  try {
    await client.connect(transport);
    const lista = await client.listTools();
    assert.deepEqual(lista.tools.map(t => t.name).sort(), ['buscar_clientes', 'buscar_registros', 'casos_cobranca', 'ver_contrato']);
    assert.ok(lista.tools.every(t => t.annotations.readOnlyHint && !t.annotations.destructiveHint));
    const busca = await client.callTool({ name: 'buscar_clientes', arguments: { texto: 'Cliente teste' } });
    assert.equal(JSON.parse(busca.content[0].text)[0].nome, 'Cliente de teste');
    const contrato = await client.callTool({ name: 'ver_contrato', arguments: { numero: '42' } });
    assert.equal(JSON.parse(contrato.content[0].text).contrato, '0042');
    assert.deepEqual(chamadas[1], ['ver_contrato', { numero: '0042' }]);
    const pagina = await client.callTool({ name: 'casos_cobranca', arguments: { etapa: 'fila', limite: 1 } });
    assert.deepEqual(JSON.parse(pagina.content[0].text), { total: 2, casos: [{ contrato: '0042', etapa: 'fila', divida: 6000 }], proximo_offset: 1 });
    const ultima = await client.callTool({ name: 'casos_cobranca', arguments: { etapa: 'fila', limite: 1, offset: 1 } });
    assert.equal(JSON.parse(ultima.content[0].text).proximo_offset, null);
    const antes = chamadas.length;
    for (const [name, args] of [ ['ver_contrato', { numero: '../42' }], ['ver_contrato', { numero: '' }], ['buscar_clientes', { texto: '  ' }], ['casos_cobranca', { limite: 1000 }], ['casos_cobranca', { offset: -1 }], ['casos_cobranca', { etapa: 'inventada' }] ]) {
      const r = await client.callTool({ name, arguments: args });
      assert.equal(r.isError, true);
    }
    assert.equal(chamadas.length, antes);
    assert.ok(!logs.join('').includes('Cliente teste'));
    assert.ok(!logs.join('').includes(token));
  } finally { await client.close(); }
});

test('erro interno e contrato inexistente não viram respostas de sucesso nem vazam dados', async () => {
  const handler = criaHandlerMcp({ env: () => token, registra: () => {}, consulta: async (nome, ent) => {
    if (ent.numero === '9999') return { erro: 'Contrato não existe' };
    throw new Error('postgres://segredo@host/dados CPF 12345678900');
  } });
  const client = new Client({ name: 'teste', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } }, fetch: (u, i) => handler(new Request(u, i)) }));
  try {
    const erro = await client.callTool({ name: 'ver_contrato', arguments: { numero: '42' } });
    assert.equal(erro.isError, true);
    assert.ok(!erro.content[0].text.includes('segredo'));
    assert.ok(!erro.content[0].text.includes('12345678900'));
    const ausente = await client.callTool({ name: 'ver_contrato', arguments: { numero: '9999' } });
    assert.equal(ausente.isError, true);
    assert.match(ausente.content[0].text, /Contrato não existe/);
  } finally { await client.close(); }
});

test('consultas compartilhadas preservam vínculo por CPF e cálculo de dívida existente, usando apenas SELECT', async () => {
  const normNome = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let dividaConsultada;
  const consultar = criaConsultasIA({
    normNome, digF: v => String(v).replace(/\D/g, ''), fonesDoCliente: () => ['62999990000'],
    q: async sql => {
      assert.match(sql.trim(), /^select /i);
      if (sql.includes('from carteira.clientes')) return [{ nome: 'José Silva', cpf: '12345678900', manual: { email: 'teste@example.com' } }];
      if (sql.includes('select numero, compradores')) return [{ numero: '0042', compradores: [{ nome: 'Outro nome', cpf: '123.456.789-00' }] }];
      if (sql.includes('select contrato, etapa')) return [{ contrato: '0042', etapa: 'fila', px: '2026-11-10' }];
      if (sql.includes('select contrato from')) return [{ contrato: '0042' }];
      return [];
    },
    dividas: async ns => { dividaConsultada = ns; return { '0042': { titular: 'José Silva', total: 123.45 } }; }
  });
  const cliente = await consultar('buscar_clientes', { texto: 'Jose' });
  assert.deepEqual(cliente[0].contratos, ['0042 (na cobrança)']);
  const casos = await consultar('casos_cobranca', {});
  assert.deepEqual(dividaConsultada, ['0042']);
  assert.equal(casos[0].divida, 123.45);
});

test('JSON inválido retorna erro de protocolo sem acessar a carteira', async () => {
  const handler = criaHandlerMcp({ env: () => token, consulta: () => assert.fail('Não deveria consultar') });
  const r = await handler(req('POST', { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, '{quebrado'));
  assert.equal(r.status, 400);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});

test('entrypoint Netlify publica a rota e permite descoberta sem conectar no banco', async () => {
  const anterior = globalThis.Netlify;
  globalThis.Netlify = { env: { get: nome => nome === 'MCP_BEARER_TOKEN' ? token : undefined } };
  const { default: handler, config } = await import('../netlify/functions/mcp.mjs');
  const client = new Client({ name: 'entrypoint-teste', version: '1' });
  try {
    assert.equal(config.path, '/mcp');
    assert.equal(config.rateLimit.windowLimit, 60);
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } }, fetch: (u, i) => handler(new Request(u, i)) }));
    assert.equal((await client.listTools()).tools.length, 4);
  } finally {
    await client.close();
    if (anterior === undefined) delete globalThis.Netlify; else globalThis.Netlify = anterior;
  }
});
