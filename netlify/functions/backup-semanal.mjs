import { backupAgendado } from './api.mjs';

export default async () => {
  try { console.log('backup', JSON.stringify(await backupAgendado())); }
  catch (e) { console.error('backup', e.message); }
};

export const config = { schedule: '0 6 * * 0' };
