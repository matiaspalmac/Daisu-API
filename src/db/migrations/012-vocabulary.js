// Migration 012 — User vocabulary + indexes
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_vocabulary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      word TEXT NOT NULL,
      translation TEXT DEFAULT '',
      language TEXT NOT NULL,
      context_sentence TEXT DEFAULT '',
      source TEXT DEFAULT 'manual',
      source_message_id INTEGER,
      mastery_level INTEGER DEFAULT 0,
      next_review_at TIMESTAMP,
      review_count INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_vocabulary_user_lang ON user_vocabulary(user_id, language)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_vocabulary_review ON user_vocabulary(user_id, next_review_at)');
  await tryExec('CREATE UNIQUE INDEX IF NOT EXISTS idx_vocabulary_user_word_lang ON user_vocabulary(user_id, word, language)');
}
