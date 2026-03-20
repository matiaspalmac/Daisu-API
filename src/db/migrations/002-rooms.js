// Migration 002 — Rooms table
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      language TEXT DEFAULT '',
      level TEXT DEFAULT '',
      type TEXT DEFAULT 'public',
      is_default INTEGER DEFAULT 0,
      daily_prompt TEXT DEFAULT '',
      prompt_updated_at TIMESTAMP,
      max_members INTEGER DEFAULT 0,
      slowmode_seconds INTEGER DEFAULT 0,
      created_by INTEGER,
      archived_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  const roomMigrations = [
    'language TEXT DEFAULT ""', 'level TEXT DEFAULT ""', 'type TEXT DEFAULT "public"',
    'is_default INTEGER DEFAULT 0', 'daily_prompt TEXT DEFAULT ""', 'prompt_updated_at TIMESTAMP',
    'description TEXT DEFAULT ""', 'max_members INTEGER DEFAULT 0', 'slowmode_seconds INTEGER DEFAULT 0',
    'created_by INTEGER', 'archived_at TIMESTAMP',
  ];
  for (const col of roomMigrations) {
    await tryExec(`ALTER TABLE rooms ADD COLUMN ${col}`);
  }
}
