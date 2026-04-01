// src/middleware/auth.js — JWT authentication & authorization
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { AuthenticationError, AuthorizationError } from '../errors/index.js';

/**
 * Generate a JWT token for a user.
 */
export function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, isAdmin: Boolean(user.isAdmin), membership_tier: user.membership_tier || 'free' },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}

/**
 * Middleware: requires a valid JWT in Authorization header.
 * Sets req.user = { id, email, isAdmin, membership_tier }.
 */
export function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new AuthenticationError('Authentication required');
  }

  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = {
      id: String(decoded.id),
      email: decoded.email,
      isAdmin: Boolean(decoded.isAdmin),
      membership_tier: decoded.membership_tier || 'free',
    };
    next();
  } catch {
    throw new AuthenticationError('Invalid or expired token');
  }
}

/**
 * Middleware: requires the authenticated user to be admin.
 * Must be used after auth().
 */
export function adminOnly(req, res, next) {
  if (!req.user?.isAdmin) {
    throw new AuthorizationError('Admin access required');
  }
  next();
}

/**
 * Middleware: requires the authenticated user to be the owner of the resource
 * (req.params.id matches req.user.id) OR an admin.
 */
export function ownerOrAdmin(req, res, next) {
  if (String(req.user?.id) !== String(req.params.id) && !req.user?.isAdmin) {
    throw new AuthorizationError('Access denied');
  }
  next();
}

/**
 * Middleware: requires the authenticated user to have a premium membership tier.
 * Must be used after auth().
 * @param {string} requiredTier - 'pro' or 'premium'
 */
export function premiumOnly(requiredTier = 'pro') {
  const tierLevels = { free: 0, pro: 1, premium: 2 };
  return (req, res, next) => {
    if (req.user?.isAdmin) return next();
    const userLevel = tierLevels[req.user?.membership_tier] ?? 0;
    const requiredLevel = tierLevels[requiredTier] ?? 1;
    if (userLevel < requiredLevel) {
      throw new AuthorizationError(`Requires ${requiredTier} membership or higher`);
    }
    next();
  };
}
