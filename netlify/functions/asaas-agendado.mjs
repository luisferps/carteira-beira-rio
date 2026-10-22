import { passoSync } from './api.mjs';

export default async () => {
  try { console.log('asaas', JSON.stringify(await passoSync(22000))); }
  catch (e) { console.error('asaas', e.message); }
};

export const config = { schedule: '0 */2 * * *' };
