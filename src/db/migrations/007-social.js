// Migration 007 — Follows, user blocks, profile views + indexes
export async function up(db, tryExec) {
  // Followers
  await db.execute(`
    CREATE TABLE IF NOT EXISTS follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL,
      following_id INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(follower_id, following_id)
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id)');

  // User Blocks
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      blocked_user_id INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, blocked_user_id)
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_blocks_user ON user_blocks(user_id)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON user_blocks(blocked_user_id)');

  // Profile Views
  await db.execute(`
    CREATE TABLE IF NOT EXISTS profile_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_owner_id INTEGER NOT NULL,
      viewer_id INTEGER NOT NULL,
      viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (profile_owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_profile_views_owner ON profile_views(profile_owner_id)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_profile_views_viewer ON profile_views(viewer_id)');
}
