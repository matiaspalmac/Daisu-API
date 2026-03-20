// Migration 022 — Quizzes, quiz attempts + indexes
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      language TEXT NOT NULL,
      level TEXT DEFAULT '',
      type TEXT DEFAULT 'vocabulary',
      questions TEXT NOT NULL,
      created_by INTEGER,
      is_daily INTEGER DEFAULT 0,
      daily_date TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      score INTEGER DEFAULT 0,
      total_questions INTEGER DEFAULT 0,
      answers TEXT DEFAULT '{}',
      completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await tryExec('CREATE INDEX IF NOT EXISTS idx_quizzes_daily ON quizzes(is_daily, daily_date, language)');
  await tryExec('CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts(user_id, quiz_id)');
}
