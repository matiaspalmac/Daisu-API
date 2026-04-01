import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { generateToken } from '../../middleware/auth.js';
import {
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from '../../errors/index.js';

export const AuthService = {
  async createUser({ name, email, password, image }) {
    const exists = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] });
    if (exists.rows.length > 0) throw new ConflictError('User already exists');

    const hashed = await bcrypt.hash(password, config.bcryptRounds);
    const result = await db.execute({
      sql: `INSERT INTO users (name, email, password, image, isAdmin, bio, nativelang, learninglang)
            VALUES (?, ?, ?, ?, 0, '', '', '')`,
      args: [name, email, hashed, image || ''],
    });

    const userId = result.lastInsertRowid.toString();
    const userRes = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [userId] });
    const user = userRes.rows[0];
    const { password: _, ...safe } = user;
    const token = generateToken({ id: userId, email, isAdmin: false });

    return { ...safe, token };
  },

  async login({ email, password }) {
    const result = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
    if (!result.rows.length) throw new AuthenticationError('Invalid credentials');
    const user = result.rows[0];
    if (!user.password) throw new AuthenticationError('Invalid credentials');
    if (!(await bcrypt.compare(password, user.password))) throw new AuthenticationError('Invalid credentials');
    if (user.deleted_at) throw new AuthenticationError('Account has been deleted');
    if (user.banned_at) throw new AuthorizationError('Account banned');

    const { password: _, deleted_at: _d, ...safe } = user;
    const token = generateToken(user);

    return { ...safe, token };
  },

  async forgotPassword(email) {
    if (!email) throw new ValidationError('Email is required');

    const result = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] });
    if (!result.rows.length) {
      // Don't reveal whether the email exists
      return { message: 'If the email exists, a reset link has been generated' };
    }

    const user = result.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + config.cleanup.passwordResetExpiry).toISOString();
    await db.execute({
      sql: 'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
      args: [user.id, token, expiresAt],
    });

    // In production, send the token via email instead of returning it
    return { message: 'If the email exists, a reset link has been generated', token };
  },

  async resetPassword({ token, newPassword }) {
    if (!token || !newPassword) throw new ValidationError('Token and new password are required');
    if (newPassword.length < 6) throw new ValidationError('Password must be at least 6 characters');

    const result = await db.execute({
      sql: "SELECT id, user_id FROM password_resets WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')",
      args: [token],
    });
    if (!result.rows.length) throw new ValidationError('Invalid or expired reset token');

    const resetRecord = result.rows[0];
    const hashed = await bcrypt.hash(newPassword, config.bcryptRounds);
    await db.execute({
      sql: 'UPDATE users SET password = ? WHERE id = ?',
      args: [hashed, resetRecord.user_id],
    });
    await db.execute({
      sql: 'UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [resetRecord.id],
    });

    return { message: 'Password reset successfully' };
  },

  async changePassword(userId, { currentPassword, newPassword }) {
    if (!currentPassword || !newPassword) throw new ValidationError('Current password and new password are required');
    if (newPassword.length < 6) throw new ValidationError('Password must be at least 6 characters');

    const result = await db.execute({ sql: 'SELECT password FROM users WHERE id = ?', args: [userId] });
    if (!result.rows.length) throw new NotFoundError('User not found');
    const user = result.rows[0];
    if (!user.password || !(await bcrypt.compare(currentPassword, user.password))) {
      throw new AuthenticationError('Current password is incorrect');
    }

    const hashed = await bcrypt.hash(newPassword, config.bcryptRounds);
    await db.execute({
      sql: 'UPDATE users SET password = ? WHERE id = ?',
      args: [hashed, userId],
    });

    return { message: 'Password changed successfully' };
  },
};
