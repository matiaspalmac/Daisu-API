// Migration 006 — Pinned messages, mentions, banned words, room bans, emoji favorites, moderator actions + indexes
export async function up(db, tryExec) {
  // Pinned Messages
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pinned_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      pinned_by INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, room_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (pinned_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Mentions
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      mentioned_user_id INTEGER NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (mentioned_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_mentions_user ON mentions(mentioned_user_id, is_read)');
  await tryExec('CREATE UNIQUE INDEX IF NOT EXISTS idx_mentions_unique_pair ON mentions(message_id, mentioned_user_id)');

  // Banned words
  await db.execute(`
    CREATE TABLE IF NOT EXISTS banned_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL UNIQUE,
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_banned_words_word ON banned_words(word)');

  // Room Bans
  await db.execute(`
    CREATE TABLE IF NOT EXISTS room_bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      banned_by INTEGER NOT NULL,
      reason TEXT DEFAULT '',
      expires_at TIMESTAMP,
      is_permanent INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, room_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_room_bans_expiry ON room_bans(expires_at)');

  // User Favorite Emojis
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_emoji_favorites (
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      count INTEGER DEFAULT 1,
      last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, emoji),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Moderator Actions Audit Log
  await db.execute(`
    CREATE TABLE IF NOT EXISTS moderator_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mod_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_user_id INTEGER,
      room_id INTEGER,
      details TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (mod_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_mod_actions_mod ON moderator_actions(mod_id)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_mod_actions_target ON moderator_actions(target_user_id)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_mod_actions_room ON moderator_actions(room_id)');
}
