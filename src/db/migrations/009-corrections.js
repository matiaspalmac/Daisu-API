// Migration 009 — AI corrections, AI usage daily, peer corrections + indexes
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ai_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      original_text TEXT NOT NULL,
      corrected_text TEXT NOT NULL,
      explanation TEXT DEFAULT '',
      language TEXT DEFAULT '',
      correction_type TEXT DEFAULT 'grammar',
      was_accepted INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_ai_corrections_user ON ai_corrections(user_id, created_at)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_ai_corrections_message ON ai_corrections(message_id)');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ai_usage_daily (
      user_id INTEGER NOT NULL,
      usage_date TEXT NOT NULL,
      corrections_used INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, usage_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Peer corrections
  await db.execute(`
    CREATE TABLE IF NOT EXISTS peer_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      corrector_id INTEGER NOT NULL,
      original_text TEXT NOT NULL,
      corrected_text TEXT NOT NULL,
      explanation TEXT DEFAULT '',
      was_helpful INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (corrector_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_peer_corrections_message ON peer_corrections(message_id)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_peer_corrections_corrector ON peer_corrections(corrector_id)');
}
