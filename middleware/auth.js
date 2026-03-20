// middleware/auth.js — JWT authentication & authorization
import jwt from 'jsonwebtoken';
import { db } from '../src/config/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Generate a JWT token for a user.
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, isAdmin: Boolean(user.isAdmin), membership_tier: user.membership_tier || 'free' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

/**
 * Middleware: requires a valid JWT in Authorization header.
 * Sets req.user = { id, email, isAdmin }.
 */
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: String(decoded.id), email: decoded.email, isAdmin: Boolean(decoded.isAdmin), membership_tier: decoded.membership_tier || 'free' };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware: requires the authenticated user to be admin.
 * Must be used after auth().
 */
function adminOnly(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Middleware: requires the authenticated user to be the owner of the resource
 * (req.params.id matches req.user.id) OR an admin.
 */
function ownerOrAdmin(req, res, next) {
  if (String(req.user?.id) !== String(req.params.id) && !req.user?.isAdmin) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

/**
 * Middleware: requires the authenticated user to have a premium membership tier.
 * Must be used after auth().
 * @param {string} requiredTier - 'pro' or 'premium'
 */
function premiumOnly(requiredTier = 'pro') {
  const tierLevels = { free: 0, pro: 1, premium: 2 };
  return (req, res, next) => {
    if (req.user?.isAdmin) return next();
    const userLevel = tierLevels[req.user?.membership_tier] ?? 0;
    const requiredLevel = tierLevels[requiredTier] ?? 1;
    if (userLevel < requiredLevel) {
      return res.status(403).json({ error: `Requires ${requiredTier} membership or higher` });
    }
    next();
  };
}

export { generateToken, auth, adminOnly, ownerOrAdmin, premiumOnly, JWT_SECRET };
