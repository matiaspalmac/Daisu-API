// src/sockets/middleware.js — JWT authentication middleware for Socket.IO
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    socket.user = {
      id: String(decoded.id),
      email: decoded.email,
      isAdmin: Boolean(decoded.isAdmin),
      membership_tier: decoded.membership_tier || 'free',
    };
    next();
  } catch (err) {
    next(new Error('Invalid or expired token'));
  }
}
