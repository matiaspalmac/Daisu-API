// src/sockets/helpers.js — Shared state and utility functions for socket handlers
import { db } from '../config/database.js';

// Online users per room: Map<roomId, Map<userId, {name, image, targetLang}>>
export const roomOnlineUsers = new Map();
// Connected sockets per user: Map<userId, Set<socketId>>
export const connectedUsers = new Map();
// Rate limiting: Map<userId, [timestamps]>
export const messageRateMap = new Map();

export function addConnectedUser(userId, socketId) {
  const key = String(userId);
  if (!connectedUsers.has(key)) connectedUsers.set(key, new Set());
  connectedUsers.get(key).add(socketId);
}

export function removeConnectedUser(userId, socketId) {
  const key = String(userId);
  if (!connectedUsers.has(key)) return;
  connectedUsers.get(key).delete(socketId);
  if (connectedUsers.get(key).size === 0) connectedUsers.delete(key);
}

export function emitToUser(io, userId, event, payload) {
  const sockets = connectedUsers.get(String(userId));
  if (!sockets || sockets.size === 0) return false;
  for (const socketId of sockets) io.to(socketId).emit(event, payload);
  return true;
}

export function getUsersInRoom(roomId) {
  return roomId && roomOnlineUsers.has(roomId)
    ? Array.from(roomOnlineUsers.get(roomId).values())
    : [];
}

export async function supportsMessageRepliesTable() {
  try {
    const result = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='message_replies' LIMIT 1");
    return Boolean(result.rows?.length);
  } catch {
    return false;
  }
}

export async function getDMOtherUser(conversationId, userId) {
  const conv = await db.execute({
    sql: 'SELECT user1_id, user2_id FROM dm_conversations WHERE id = ?',
    args: [conversationId],
  });
  if (!conv.rows.length) return null;
  const { user1_id, user2_id } = conv.rows[0];
  const uid = String(userId);
  if (String(user1_id) !== uid && String(user2_id) !== uid) return null; // not a participant
  return String(user1_id) === uid ? String(user2_id) : String(user1_id);
}
