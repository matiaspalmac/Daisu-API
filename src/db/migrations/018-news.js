// Migration 018 — News articles + indexes
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS news_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      excerpt TEXT DEFAULT '',
      category TEXT NOT NULL,
      cover_image_url TEXT DEFAULT '',
      language TEXT DEFAULT '',
      author_id INTEGER,
      is_published INTEGER DEFAULT 0,
      published_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_news_category ON news_articles(category, is_published)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles(is_published, published_at)');
}
