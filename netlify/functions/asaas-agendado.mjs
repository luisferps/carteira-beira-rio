import { passoSync, passoBoletos, rodaCobranca60, reprocessaPendentes } from './api.mjs';

export default async () => {
  for (const [nome, f] of [['pagamentos', () => passoSync(10000)], ['pendentes', () => reprocessaPendentes(5000)], ['boletos', () => passoBoletos(8000)], ['cobranca60', () => rodaCobranca60(6000)]]) {
    try { console.log('asaas', nome, JSON.stringify(await f())); }
    catch (e) { console.error('asaas', nome, e.message); }
  }
};

export const config = { schedule: '0 */2 * * *' };
