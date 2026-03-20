// Migration 015 — Events, event attendees + indexes
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT DEFAULT 'session',
      language TEXT DEFAULT '',
      level TEXT DEFAULT '',
      host_user_id INTEGER NOT NULL,
      room_id INTEGER,
      max_attendees INTEGER DEFAULT 0,
      starts_at TIMESTAMP NOT NULL,
      ends_at TIMESTAMP,
      timezone TEXT DEFAULT 'UTC',
      is_recurring INTEGER DEFAULT 0,
      recurrence_rule TEXT DEFAULT '',
      status TEXT DEFAULT 'scheduled',
      is_premium INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at, status)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_events_host ON events(host_user_id)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_events_language ON events(language)');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS event_attendees (
      event_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT DEFAULT 'registered',
      registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (event_id, user_id),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_event_attendees_user ON event_attendees(user_id)');
}
