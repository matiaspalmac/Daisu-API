// Migration 014 — DM conversations and messages + indexes
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS dm_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1_id INTEGER NOT NULL,
      user2_id INTEGER NOT NULL,
      last_message_at TIMESTAMP,
      last_message_preview TEXT DEFAULT '',
      user1_unread_count INTEGER DEFAULT 0,
      user2_unread_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user1_id, user2_id),
      FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_dm_user1 ON dm_conversations(user1_id)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_dm_user2 ON dm_conversations(user2_id)');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS dm_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      message_type TEXT DEFAULT 'text',
      edited_at TIMESTAMP,
      deleted_at TIMESTAMP,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_dm_messages_conv ON dm_messages(conversation_id, sent_at)');
}
