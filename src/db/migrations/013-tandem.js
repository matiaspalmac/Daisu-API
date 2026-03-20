// Migration 013 — Tandem sessions + indexes
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tandem_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      user1_id INTEGER NOT NULL,
      user2_id INTEGER NOT NULL,
      language TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMP,
      duration_seconds INTEGER DEFAULT 0,
      user1_rating INTEGER,
      user2_rating INTEGER,
      user1_feedback TEXT DEFAULT '',
      user2_feedback TEXT DEFAULT '',
      message_count INTEGER DEFAULT 0,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
      FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_tandem_user1 ON tandem_sessions(user1_id)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_tandem_user2 ON tandem_sessions(user2_id)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_tandem_status ON tandem_sessions(status)');
}
