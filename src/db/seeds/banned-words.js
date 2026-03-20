export async function seedBannedWords(db) {
  for (const word of ['spam', 'abuse', 'hate', 'harassment']) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO banned_words (word) VALUES (?)',
      args: [word],
    });
  }
}
