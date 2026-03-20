// routes/memberships.js — Membership plans, subscriptions & payment history
import express from 'express';
import { db } from '../../config/database.js';
import { auth, adminOnly } from '../../../middleware/auth.js';

const router = express.Router();

// ──────────────────────────────────────────
// GET /api/memberships/plans — public: list all plans
// ──────────────────────────────────────────
router.get('/memberships/plans', async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM membership_plans ORDER BY price_cents ASC');

        const plans = result.rows.map((plan) => ({
            ...plan,
            features: typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features,
        }));

        res.json({ plans });
    } catch (e) {
        console.error('List plans error:', e);
        res.status(500).json({ error: 'Error fetching membership plans' });
    }
});

// ──────────────────────────────────────────
// GET /api/memberships/my — auth: current user's membership info
// ──────────────────────────────────────────
router.get('/memberships/my', auth, async (req, res) => {
    try {
        const userRes = await db.execute({
            sql: 'SELECT membership_tier, membership_expires_at FROM users WHERE id = ?',
            args: [req.user.id],
        });

        if (!userRes.rows.length) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = userRes.rows[0];
        const tier = user.membership_tier || 'free';

        const planRes = await db.execute({
            sql: 'SELECT * FROM membership_plans WHERE id = ?',
            args: [tier],
        });

        const plan = planRes.rows[0] || null;
        const features = plan && typeof plan.features === 'string' ? JSON.parse(plan.features) : (plan?.features || {});

        res.json({
            tier,
            expires_at: user.membership_expires_at || null,
            plan: plan ? { id: plan.id, name: plan.name, price_cents: plan.price_cents, currency: plan.currency } : null,
            features,
        });
    } catch (e) {
        console.error('Get membership error:', e);
        res.status(500).json({ error: 'Error fetching membership info' });
    }
});

// ──────────────────────────────────────────
// POST /api/memberships/subscribe — auth: subscribe to a plan
// ──────────────────────────────────────────
router.post('/memberships/subscribe', auth, async (req, res) => {
    try {
        const { planId, paymentProvider, providerTxId } = req.body;

        if (!planId || !paymentProvider || !providerTxId) {
            return res.status(400).json({ error: 'planId, paymentProvider, and providerTxId are required' });
        }

        // Verify plan exists
        const planRes = await db.execute({
            sql: 'SELECT * FROM membership_plans WHERE id = ?',
            args: [planId],
        });

        if (!planRes.rows.length) {
            return res.status(404).json({ error: 'Plan not found' });
        }

        const plan = planRes.rows[0];

        // Calculate expiry: 30 days from now
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        // Update user membership
        await db.execute({
            sql: 'UPDATE users SET membership_tier = ?, membership_expires_at = ? WHERE id = ?',
            args: [planId, expiresAt.toISOString(), req.user.id],
        });

        // Create payment history record
        await db.execute({
            sql: `INSERT INTO payment_history (user_id, plan_id, amount_cents, currency, payment_provider, provider_tx_id, status, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, 'completed', CURRENT_TIMESTAMP)`,
            args: [
                req.user.id,
                planId,
                plan.price_cents,
                plan.currency || 'USD',
                paymentProvider,
                providerTxId,
            ],
        });

        res.json({
            message: 'Subscription activated',
            tier: planId,
            expires_at: expiresAt.toISOString(),
        });
    } catch (e) {
        console.error('Subscribe error:', e);
        res.status(500).json({ error: 'Error processing subscription' });
    }
});

// ──────────────────────────────────────────
// POST /api/memberships/cancel — auth: cancel subscription
// ──────────────────────────────────────────
router.post('/memberships/cancel', auth, async (req, res) => {
    try {
        await db.execute({
            sql: 'UPDATE users SET membership_tier = ?, membership_expires_at = NULL WHERE id = ?',
            args: ['free', req.user.id],
        });

        res.json({ message: 'Subscription cancelled', tier: 'free' });
    } catch (e) {
        console.error('Cancel subscription error:', e);
        res.status(500).json({ error: 'Error cancelling subscription' });
    }
});

// ──────────────────────────────────────────
// GET /api/memberships/history — auth: current user's payment history
// ──────────────────────────────────────────
router.get('/memberships/history', auth, async (req, res) => {
    try {
        const result = await db.execute({
            sql: `SELECT ph.*, mp.name AS plan_name
                  FROM payment_history ph
                  LEFT JOIN membership_plans mp ON mp.id = ph.plan_id
                  WHERE ph.user_id = ?
                  ORDER BY ph.created_at DESC`,
            args: [req.user.id],
        });

        res.json({ payments: result.rows });
    } catch (e) {
        console.error('Payment history error:', e);
        res.status(500).json({ error: 'Error fetching payment history' });
    }
});

// ──────────────────────────────────────────
// GET /api/admin/memberships/stats — admin: subscriber counts & revenue
// ──────────────────────────────────────────
router.get('/admin/memberships/stats', auth, adminOnly, async (req, res) => {
    try {
        const [tierCountsRes, revenueRes] = await Promise.all([
            db.execute(`
                SELECT membership_tier AS tier, COUNT(*) AS count
                FROM users
                GROUP BY membership_tier
                ORDER BY count DESC
            `),
            db.execute(`
                SELECT COALESCE(SUM(amount_cents), 0) AS total_revenue_cents,
                       COUNT(*) AS total_transactions
                FROM payment_history
                WHERE status = 'completed'
            `),
        ]);

        const subscribersByTier = {};
        for (const row of tierCountsRes.rows) {
            subscribersByTier[row.tier || 'free'] = Number(row.count);
        }

        const revenue = revenueRes.rows[0] || { total_revenue_cents: 0, total_transactions: 0 };

        res.json({
            subscribers_by_tier: subscribersByTier,
            total_revenue_cents: Number(revenue.total_revenue_cents),
            total_transactions: Number(revenue.total_transactions),
        });
    } catch (e) {
        console.error('Membership stats error:', e);
        res.status(500).json({ error: 'Error fetching membership stats' });
    }
});

export default router;
