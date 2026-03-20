import { db } from '../config/database.js';
import { runMigrations } from './migrations/index.js';
import { runSeeds } from './seeds/index.js';
import { DAILY_PROMPTS } from './seeds/rooms.js';

async function tryExec(sql, args) {
  try { await db.execute(args ? { sql, args } : sql); } catch (_) { }
}

async function createTables() {
  try {
    await runMigrations(db, tryExec);
    await runSeeds(db);
    console.log('✅ DB tables created / migrated and data seeded');
  } catch (e) {
    console.error('Error in createTables:', e);
  }
}

export { db, createTables, DAILY_PROMPTS };
