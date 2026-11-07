import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function ambiente(nomeSalvo, nomeEscolhido) {
  let salvo = nomeSalvo ? { name: nomeSalvo, requestPermission: async () => 'granted' } : null;
  let escolhas = 0;
  const db = { transaction: () => ({ objectStore: () => ({
    get: () => { const r = {}; queueMicrotask(() => { r.result = salvo; r.onsuccess(); }); return r; },
    put: h => { salvo = h; }
  }) }) };
  const window = { showDirectoryPicker: async () => { escolhas++; return { name: nomeEscolhido }; } };
  const indexedDB = { open: () => { const r = {}; queueMicrotask(() => { r.result = db; r.onsuccess(); }); return r; } };
  vm.runInNewContext(readFileSync(new URL('../public/ferramentas/termo.js', import.meta.url), 'utf8'), { window, indexedDB, alert: () => {} });
  return { window, estado: () => ({ salvo: salvo?.name, escolhas }) };
}

test('reutiliza destino Negociações já autorizado', async () => {
  const a = ambiente('Negociações', 'Outra');
  assert.equal((await a.window.pastaRenegociacoes()).name, 'Negociações');
  assert.equal(a.estado().escolhas, 0);
});

test('substitui seleção antiga Renegociações pelo destino correto', async () => {
  const a = ambiente('Renegociações', 'Negociações');
  assert.equal((await a.window.pastaRenegociacoes()).name, 'Negociações');
  assert.deepEqual(a.estado(), { salvo: 'Negociações', escolhas: 1 });
});

test('recusa outra pasta e preserva seleção anterior', async () => {
  const a = ambiente('Renegociações', 'Downloads');
  assert.equal(await a.window.pastaRenegociacoes(), null);
  assert.equal(a.estado().salvo, 'Renegociações');
});

test('botão de configuração permite escolher novamente o destino', async () => {
  const a = ambiente('Negociações', 'Negociações');
  assert.equal(await a.window.escolhePastaTermo(), true);
  assert.equal(a.estado().escolhas, 1);
});
