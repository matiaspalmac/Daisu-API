// Migration 005 — User stats, chat settings, moderation, room roles
export async function up(db, tryExec) {
  // User stats
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_stats (
      user_id INTEGER PRIMARY KEY,
      messages_sent INTEGER DEFAULT 0,
      words_sent INTEGER DEFAULT 0,
      corrections_given INTEGER DEFAULT 0,
      streak INTEGER DEFAULT 0,
      longest_streak INTEGER DEFAULT 0,
      xp INTEGER DEFAULT 0,
      tandem_sessions_completed INTEGER DEFAULT 0,
      corrections_received INTEGER DEFAULT 0,
      vocabulary_count INTEGER DEFAULT 0,
      last_streak_date TEXT DEFAULT '',
      last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  const statMigrations = [
    'longest_streak INTEGER DEFAULT 0', 'xp INTEGER DEFAULT 0',
    'tandem_sessions_completed INTEGER DEFAULT 0', 'corrections_received INTEGER DEFAULT 0',
    'vocabulary_count INTEGER DEFAULT 0', 'last_streak_date TEXT DEFAULT ""',
  ];
  for (const col of statMigrations) {
    await tryExec(`ALTER TABLE user_stats ADD COLUMN ${col}`);
  }

  // Chat UI settings per user
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_chat_settings (
      user_id INTEGER PRIMARY KEY,
      bubble_theme TEXT DEFAULT 'neon',
      my_bubble_color TEXT DEFAULT '#2d88ff',
      other_bubble_color TEXT DEFAULT '#1e2430',
      font_size TEXT DEFAULT 'medium',
      effects_enabled INTEGER DEFAULT 1,
      text_only_mode INTEGER DEFAULT 0,
      data_saver_mode INTEGER DEFAULT 0,
      disable_profile_images INTEGER DEFAULT 0,
      room_backgrounds TEXT DEFAULT '{}',
      nicknames TEXT DEFAULT '{}',
      last_room_id TEXT DEFAULT '',
      room_drafts TEXT DEFAULT '{}',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Personal moderation (mute/block)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_moderation (
      user_id INTEGER NOT NULL,
      target_user_id INTEGER NOT NULL,
      muted INTEGER DEFAULT 0,
      blocked INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, target_user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_user_moderation_user ON user_moderation(user_id)');

  // User-Room Roles
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_room_roles (
      user_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      role TEXT DEFAULT 'user',
      assigned_by INTEGER,
      assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, room_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_user_room_roles_room ON user_room_roles(room_id)');
}
