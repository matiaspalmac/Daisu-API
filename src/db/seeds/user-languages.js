export async function migrateUserLanguages(db) {
  try {
    const users = await db.execute("SELECT id, nativelang, targetLang, level FROM users WHERE nativelang != '' OR targetLang != ''");
    for (const u of users.rows) {
      if (u.nativelang) {
        await db.execute({
          sql: 'INSERT OR IGNORE INTO user_languages (user_id, language, type, level, is_primary) VALUES (?, ?, ?, ?, ?)',
          args: [u.id, u.nativelang, 'native', 'C2', 1],
        });
      }
      if (u.targetLang) {
        await db.execute({
          sql: 'INSERT OR IGNORE INTO user_languages (user_id, language, type, level, is_primary) VALUES (?, ?, ?, ?, ?)',
          args: [u.id, u.targetLang, 'learning', u.level || 'A1', 1],
        });
      }
    }
  } catch (_) { }
}
