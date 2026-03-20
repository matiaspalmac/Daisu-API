// Migration 021 — User presence + index
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_presence (
      user_id INTEGER PRIMARY KEY,
      is_online INTEGER DEFAULT 0,
      last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      current_room_id INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_user_presence_online ON user_presence(is_online)');
}
