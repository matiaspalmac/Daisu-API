// Migration 017 — Resources, resource saves + indexes
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      url TEXT DEFAULT '',
      type TEXT NOT NULL,
      language TEXT DEFAULT '',
      level TEXT DEFAULT '',
      thumbnail_url TEXT DEFAULT '',
      author TEXT DEFAULT '',
      is_featured INTEGER DEFAULT 0,
      is_premium INTEGER DEFAULT 0,
      created_by INTEGER,
      view_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_resources_language ON resources(language)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_resources_level ON resources(level)');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS resource_saves (
      user_id INTEGER NOT NULL,
      resource_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, resource_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
    )
  `);
}
