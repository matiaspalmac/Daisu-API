export const DEFAULT_PLANS = [
  { id: 'free', name: 'Free', price_cents: 0, features: JSON.stringify({ ai_corrections_daily: 5, vocabulary_limit: 100, dm_limit: 3, events_access: false, premium_resources: false, custom_rooms: 0 }) },
  { id: 'pro', name: 'Pro', price_cents: 299, features: JSON.stringify({ ai_corrections_daily: 50, vocabulary_limit: 2000, dm_limit: 20, events_access: true, premium_resources: false, custom_rooms: 3 }) },
  { id: 'premium', name: 'Premium', price_cents: 999, features: JSON.stringify({ ai_corrections_daily: -1, vocabulary_limit: -1, dm_limit: -1, events_access: true, premium_resources: true, custom_rooms: -1 }) },
];

export async function seedMemberships(db) {
  for (const plan of DEFAULT_PLANS) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO membership_plans (id, name, price_cents, features) VALUES (?, ?, ?, ?)',
      args: [plan.id, plan.name, plan.price_cents, plan.features],
    });
  }
}
