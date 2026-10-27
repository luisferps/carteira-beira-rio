import { importaWhatsPasso } from './api.mjs';

export default async () => {
  try { console.log('importa-whatsapp', JSON.stringify(await importaWhatsPasso(2000))); }
  catch (e) { console.error('importa-whatsapp', e.message); }
};

export const config = { schedule: '* * * * *' };
