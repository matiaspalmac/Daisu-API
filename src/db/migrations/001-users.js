// Migration 001 — Users table
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT,
      image TEXT DEFAULT '',
      cover_image TEXT DEFAULT '',
      isAdmin INTEGER DEFAULT 0,
      banned_at TIMESTAMP,
      bio TEXT DEFAULT '',
      nativelang TEXT DEFAULT '',
      learninglang TEXT DEFAULT '',
      targetLang TEXT DEFAULT '',
      level TEXT DEFAULT 'A1',
      country TEXT DEFAULT '',
      interests TEXT DEFAULT '[]',
      tandem_goal TEXT DEFAULT '',
      streak INTEGER DEFAULT 0,
      last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_public INTEGER DEFAULT 1,
      hide_old_messages INTEGER DEFAULT 0,
      bubble_color TEXT DEFAULT '#2d88ff',
      membership_tier TEXT DEFAULT 'free',
      membership_expires_at TIMESTAMP,
      stripe_customer_id TEXT DEFAULT '',
      xp INTEGER DEFAULT 0,
      timezone TEXT DEFAULT '',
      notification_prefs TEXT DEFAULT '{}'
    )
  `);

  const userMigrations = [
    'targetLang TEXT DEFAULT ""', 'level TEXT DEFAULT "A1"', 'country TEXT DEFAULT ""',
    'interests TEXT DEFAULT "[]"', 'tandem_goal TEXT DEFAULT ""', 'streak INTEGER DEFAULT 0',
    'cover_image TEXT DEFAULT ""', 'banned_at TIMESTAMP', 'last_active TIMESTAMP',
    'is_public INTEGER DEFAULT 1', 'hide_old_messages INTEGER DEFAULT 0', 'bubble_color TEXT DEFAULT "#2d88ff"',
    'membership_tier TEXT DEFAULT "free"', 'membership_expires_at TIMESTAMP',
    'stripe_customer_id TEXT DEFAULT ""', 'xp INTEGER DEFAULT 0',
    'timezone TEXT DEFAULT ""', 'notification_prefs TEXT DEFAULT "{}"',
    'deleted_at TIMESTAMP',
  ];
  for (const col of userMigrations) {
    await tryExec(`ALTER TABLE users ADD COLUMN ${col}`);
  }
}
