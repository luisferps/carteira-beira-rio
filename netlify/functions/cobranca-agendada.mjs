import { cobrancaAutomatica } from './api.mjs';

export default async () => {
  try { console.log('cobranca_fila', JSON.stringify(await cobrancaAutomatica())); }
  catch (e) { console.error('cobranca_fila', e.message); }
};

export const config = { schedule: '30 */2 * * *' };
