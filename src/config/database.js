import { createClient } from '@libsql/client';
import { config } from './index.js';

export const db = createClient({
  url: config.db.url,
  authToken: config.db.authToken,
});
