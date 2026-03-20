// Migration 003 — Messages, reactions, message_replies, reports + indexes
export async function up(db, tryExec) {
  // Messages
  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      detected_lang TEXT DEFAULT '',
      reply_to_id TEXT DEFAULT '',
      reply_to_username TEXT DEFAULT '',
      reply_to_content TEXT DEFAULT '',
      message_type TEXT DEFAULT 'text',
      edited_at TIMESTAMP,
      deleted_at TIMESTAMP,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    )
  `);

  const msgMigrations = [
    'detected_lang TEXT DEFAULT ""', 'reply_to_id TEXT DEFAULT ""',
    'reply_to_username TEXT DEFAULT ""', 'reply_to_content TEXT DEFAULT ""',
    'message_type TEXT DEFAULT "text"', 'edited_at TIMESTAMP', 'deleted_at TIMESTAMP',
  ];
  for (const col of msgMigrations) {
    await tryExec(`ALTER TABLE messages ADD COLUMN ${col}`);
  }

  // Critical performance indexes for messages
  await tryExec('CREATE INDEX IF NOT EXISTS idx_messages_room_sent ON messages(room_id, sent_at)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_messages_user_sent ON messages(user_id, sent_at)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(deleted_at)');

  // Reactions
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, user_id, emoji),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Message replies metadata
  await db.execute(`
    CREATE TABLE IF NOT EXISTS message_replies (
      message_id INTEGER PRIMARY KEY,
      reply_to_id TEXT DEFAULT '',
      reply_to_username TEXT DEFAULT '',
      reply_to_content TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_message_replies_reply_to_id ON message_replies(reply_to_id)');

  // Reports
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      reporter_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      notes TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}
