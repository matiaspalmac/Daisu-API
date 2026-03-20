// Migration 008 — User languages + indexes
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_languages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      language TEXT NOT NULL,
      type TEXT NOT NULL,
      level TEXT DEFAULT 'A1',
      is_primary INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_user_languages_user ON user_languages(user_id)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_user_languages_lang_type ON user_languages(language, type)');
  await tryExec('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_languages_unique ON user_languages(user_id, language, type)');
}
