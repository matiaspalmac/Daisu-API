import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { NotFoundError, ValidationError } from '../../errors/index.js';

export const MembershipsService = {
  async listPlans() {
    const result = await db.execute('SELECT * FROM membership_plans ORDER BY price_cents ASC');
    return { plans: result.rows.map(plan => ({ ...plan, features: typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features })) };
  },

  async getMyMembership(userId) {
    const userRes = await db.execute({ sql: 'SELECT membership_tier, membership_expires_at FROM users WHERE id = ?', args: [userId] });
    if (!userRes.rows.length) throw new NotFoundError('User not found');
    const user = userRes.rows[0]; const tier = user.membership_tier || 'free';
    const planRes = await db.execute({ sql: 'SELECT * FROM membership_plans WHERE id = ?', args: [tier] });
    const plan = planRes.rows[0] || null;
    const features = plan && typeof plan.features === 'string' ? JSON.parse(plan.features) : (plan?.features || {});
    return { tier, expires_at: user.membership_expires_at || null, plan: plan ? { id: plan.id, name: plan.name, price_cents: plan.price_cents, currency: plan.currency } : null, features };
  },

  async subscribe(userId, { planId, paymentProvider, providerTxId }) {
    if (!planId || !paymentProvider || !providerTxId) throw new ValidationError('planId, paymentProvider, and providerTxId are required');
    const planRes = await db.execute({ sql: 'SELECT * FROM membership_plans WHERE id = ?', args: [planId] });
    if (!planRes.rows.length) throw new NotFoundError('Plan not found');
    const plan = planRes.rows[0];
    const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + config.limits.membershipDurationDays);
    await db.execute({ sql: 'UPDATE users SET membership_tier = ?, membership_expires_at = ? WHERE id = ?', args: [planId, expiresAt.toISOString(), userId] });
    await db.execute({
      sql: `INSERT INTO payment_history (user_id, plan_id, amount_cents, currency, payment_provider, provider_tx_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'completed', CURRENT_TIMESTAMP)`,
      args: [userId, planId, plan.price_cents, plan.currency || 'USD', paymentProvider, providerTxId],
    });
    return { message: 'Subscription activated', tier: planId, expires_at: expiresAt.toISOString() };
  },

  async cancel(userId) {
    await db.execute({ sql: 'UPDATE users SET membership_tier = ?, membership_expires_at = NULL WHERE id = ?', args: ['free', userId] });
    return { message: 'Subscription cancelled', tier: 'free' };
  },

  async getHistory(userId) {
    const result = await db.execute({
      sql: `SELECT ph.*, mp.name AS plan_name FROM payment_history ph LEFT JOIN membership_plans mp ON mp.id = ph.plan_id WHERE ph.user_id = ? ORDER BY ph.created_at DESC`,
      args: [userId],
    });
    return { payments: result.rows };
  },

  async getAdminStats() {
    const [tierCountsRes, revenueRes] = await Promise.all([
      db.execute('SELECT membership_tier AS tier, COUNT(*) AS count FROM users GROUP BY membership_tier ORDER BY count DESC'),
      db.execute("SELECT COALESCE(SUM(amount_cents), 0) AS total_revenue_cents, COUNT(*) AS total_transactions FROM payment_history WHERE status = 'completed'"),
    ]);
    const subscribersByTier = { free: 0, pro: 0, premium: 0 };
    for (const row of tierCountsRes.rows) subscribersByTier[row.tier || 'free'] = row.count;
    const revenue = revenueRes.rows[0] || { total_revenue_cents: 0, total_transactions: 0 };
    return { subscribers_by_tier: subscribersByTier, total_revenue_cents: Number(revenue.total_revenue_cents), total_transactions: Number(revenue.total_transactions) };
  },
};
