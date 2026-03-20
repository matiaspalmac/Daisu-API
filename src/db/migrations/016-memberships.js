// Migration 016 — Membership plans, payment history + indexes
export async function up(db, tryExec) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS membership_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_cents INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      features TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS payment_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT DEFAULT 'USD',
      payment_provider TEXT DEFAULT '',
      provider_tx_id TEXT DEFAULT '',
      status TEXT DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES membership_plans(id)
    )
  `);
  await tryExec('CREATE INDEX IF NOT EXISTS idx_payment_history_user ON payment_history(user_id)');
}
