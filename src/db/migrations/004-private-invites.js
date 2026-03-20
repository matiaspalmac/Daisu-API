// Migration 004 — Private chat invites
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS private_chat_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      responded_at TIMESTAMP,
      rejected_at TIMESTAMP,
      FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await tryExec('ALTER TABLE private_chat_invites ADD COLUMN responded_at TIMESTAMP');
  await tryExec('ALTER TABLE private_chat_invites ADD COLUMN rejected_at TIMESTAMP');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_private_invites_pair ON private_chat_invites(from_user_id, to_user_id, created_at)');
}
