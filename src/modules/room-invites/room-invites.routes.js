// routes/room-invites.js — Room invites & membership
import express from 'express';
import { db } from '../../config/database.js';
import { auth } from '../../../middleware/auth.js';
import { createNotification } from '../notifications/notifications.service.js';

const router = express.Router();

// ────────────────────────────────────────────
// POST /api/rooms/:roomId/invite — Send a room invite
// ────────────────────────────────────────────
router.post('/rooms/:roomId/invite', auth, async (req, res) => {
  const roomId = Number(req.params.roomId);
  const inviterId = req.user.id;
  const { userId: inviteeId } = req.body;

  if (!inviteeId) return res.status(400).json({ error: 'userId is required' });
  if (inviteeId === inviterId) return res.status(400).json({ error: 'Cannot invite yourself' });

  try {
    // Check room exists
    const roomResult = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [roomId] });
    if (!roomResult.rows.length) return res.status(404).json({ error: 'Room not found' });
    const room = roomResult.rows[0];

    // Check inviter is member, mod/owner, or room is public
    if (room.type !== 'public') {
      const roleResult = await db.execute({
        sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?',
        args: [inviterId, roomId],
      });
      const memberResult = await db.execute({
        sql: 'SELECT 1 FROM room_members WHERE user_id = ? AND room_id = ?',
        args: [inviterId, roomId],
      });
      const isCreator = room.created_by === inviterId;
      const hasRole = roleResult.rows.length > 0;
      const isMember = memberResult.rows.length > 0;
      if (!isCreator && !hasRole && !isMember) {
        return res.status(403).json({ error: 'You are not a member of this room' });
      }
    }

    // Check invitee exists
    const inviteeResult = await db.execute({ sql: 'SELECT id, name FROM users WHERE id = ?', args: [inviteeId] });
    if (!inviteeResult.rows.length) return res.status(404).json({ error: 'User not found' });

    // Check invitee is not already a member
    const existingMember = await db.execute({
      sql: 'SELECT 1 FROM room_members WHERE user_id = ? AND room_id = ?',
      args: [inviteeId, roomId],
    });
    if (existingMember.rows.length) return res.status(409).json({ error: 'User is already a member of this room' });

    // Check not blocked
    const blocked = await db.execute({
      sql: `SELECT 1 FROM user_blocks WHERE
            (user_id = ? AND blocked_user_id = ? AND is_active = 1) OR
            (user_id = ? AND blocked_user_id = ? AND is_active = 1)`,
      args: [inviterId, inviteeId, inviteeId, inviterId],
    });
    if (blocked.rows.length) return res.status(403).json({ error: 'Cannot send invite due to block' });

    // Check no pending invite already
    const pendingInvite = await db.execute({
      sql: `SELECT 1 FROM room_invites WHERE room_id = ? AND invitee_id = ? AND status = 'pending'`,
      args: [roomId, inviteeId],
    });
    if (pendingInvite.rows.length) return res.status(409).json({ error: 'A pending invite already exists for this user' });

    // Insert invite
    await db.execute({
      sql: 'INSERT INTO room_invites (room_id, inviter_id, invitee_id) VALUES (?, ?, ?)',
      args: [roomId, inviterId, inviteeId],
    });

    // Notify invitee
    createNotification(
      inviteeId,
      'room_invite',
      'Room Invite',
      `You have been invited to join "${room.name}"`,
      { roomId, inviterId, roomName: room.name },
    ).catch(console.error);

    res.status(201).json({ message: 'Invite sent' });
  } catch (e) {
    console.error('Room invite error:', e);
    res.status(500).json({ error: 'Error sending invite' });
  }
});

// ────────────────────────────────────────────
// GET /api/rooms/:roomId/invites — Pending invites for a room (mod/owner only)
// ────────────────────────────────────────────
router.get('/rooms/:roomId/invites', auth, async (req, res) => {
  const roomId = Number(req.params.roomId);
  const userId = req.user.id;

  try {
    // Check room exists
    const roomResult = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [roomId] });
    if (!roomResult.rows.length) return res.status(404).json({ error: 'Room not found' });
    const room = roomResult.rows[0];

    // Check mod/owner/admin
    const isAdmin = req.user.isAdmin === 1;
    const isCreator = room.created_by === userId;
    let isMod = false;
    if (!isAdmin && !isCreator) {
      const roleResult = await db.execute({
        sql: "SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ? AND role IN ('mod', 'owner')",
        args: [userId, roomId],
      });
      isMod = roleResult.rows.length > 0;
      if (!isMod) return res.status(403).json({ error: 'Only moderators and owners can view room invites' });
    }

    const result = await db.execute({
      sql: `SELECT ri.id, ri.status, ri.created_at,
              u.id as invitee_id, u.name as invitee_name, u.image as invitee_image,
              inv.id as inviter_id, inv.name as inviter_name
            FROM room_invites ri
            JOIN users u ON ri.invitee_id = u.id
            JOIN users inv ON ri.inviter_id = inv.id
            WHERE ri.room_id = ? AND ri.status = 'pending'
            ORDER BY ri.created_at DESC`,
      args: [roomId],
    });
    res.json(result.rows);
  } catch (e) {
    console.error('Room invites list error:', e);
    res.status(500).json({ error: 'Error fetching invites' });
  }
});

// ────────────────────────────────────────────
// GET /api/invites — Current user's pending room invites
// ────────────────────────────────────────────
router.get('/invites', auth, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await db.execute({
      sql: `SELECT ri.id, ri.room_id, ri.status, ri.created_at,
              r.name as room_name, r.description as room_description, r.type as room_type, r.language as room_language,
              inv.id as inviter_id, inv.name as inviter_name, inv.image as inviter_image
            FROM room_invites ri
            JOIN rooms r ON ri.room_id = r.id
            JOIN users inv ON ri.inviter_id = inv.id
            WHERE ri.invitee_id = ? AND ri.status = 'pending'
            ORDER BY ri.created_at DESC`,
      args: [userId],
    });
    res.json(result.rows);
  } catch (e) {
    console.error('User invites error:', e);
    res.status(500).json({ error: 'Error fetching invites' });
  }
});

// ────────────────────────────────────────────
// POST /api/invites/:id/accept — Accept a room invite
// ────────────────────────────────────────────
router.post('/invites/:id/accept', auth, async (req, res) => {
  const inviteId = Number(req.params.id);
  const userId = req.user.id;

  try {
    // Verify invite belongs to current user and is pending
    const inviteResult = await db.execute({
      sql: `SELECT ri.*, r.name as room_name FROM room_invites ri
            JOIN rooms r ON ri.room_id = r.id
            WHERE ri.id = ? AND ri.invitee_id = ? AND ri.status = 'pending'`,
      args: [inviteId, userId],
    });
    if (!inviteResult.rows.length) return res.status(404).json({ error: 'Invite not found or already responded' });
    const invite = inviteResult.rows[0];

    // Update status
    await db.execute({
      sql: `UPDATE room_invites SET status = 'accepted', responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [inviteId],
    });

    // Add to room_members
    await db.execute({
      sql: 'INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)',
      args: [invite.room_id, userId],
    });

    // Return room info
    const roomResult = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [invite.room_id] });
    res.json({ message: 'Invite accepted', room: roomResult.rows[0] });
  } catch (e) {
    console.error('Accept invite error:', e);
    res.status(500).json({ error: 'Error accepting invite' });
  }
});

// ────────────────────────────────────────────
// POST /api/invites/:id/decline — Decline a room invite
// ────────────────────────────────────────────
router.post('/invites/:id/decline', auth, async (req, res) => {
  const inviteId = Number(req.params.id);
  const userId = req.user.id;

  try {
    const inviteResult = await db.execute({
      sql: `SELECT * FROM room_invites WHERE id = ? AND invitee_id = ? AND status = 'pending'`,
      args: [inviteId, userId],
    });
    if (!inviteResult.rows.length) return res.status(404).json({ error: 'Invite not found or already responded' });

    await db.execute({
      sql: `UPDATE room_invites SET status = 'declined', responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [inviteId],
    });

    res.json({ message: 'Invite declined' });
  } catch (e) {
    console.error('Decline invite error:', e);
    res.status(500).json({ error: 'Error declining invite' });
  }
});

// ────────────────────────────────────────────
// GET /api/rooms/:roomId/members — Get room members
// ────────────────────────────────────────────
router.get('/rooms/:roomId/members', auth, async (req, res) => {
  const roomId = Number(req.params.roomId);

  try {
    const roomResult = await db.execute({ sql: 'SELECT id FROM rooms WHERE id = ?', args: [roomId] });
    if (!roomResult.rows.length) return res.status(404).json({ error: 'Room not found' });

    const result = await db.execute({
      sql: `SELECT u.id, u.name, u.image, u.nativelang, u.targetLang, u.level, u.country,
              rm.joined_at,
              urr.role
            FROM room_members rm
            JOIN users u ON rm.user_id = u.id
            LEFT JOIN user_room_roles urr ON urr.user_id = u.id AND urr.room_id = rm.room_id
            WHERE rm.room_id = ?
            ORDER BY rm.joined_at ASC`,
      args: [roomId],
    });
    res.json(result.rows);
  } catch (e) {
    console.error('Room members error:', e);
    res.status(500).json({ error: 'Error fetching members' });
  }
});

// ────────────────────────────────────────────
// POST /api/rooms/:roomId/join — Join a public room
// ────────────────────────────────────────────
router.post('/rooms/:roomId/join', auth, async (req, res) => {
  const roomId = Number(req.params.roomId);
  const userId = req.user.id;

  try {
    const roomResult = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [roomId] });
    if (!roomResult.rows.length) return res.status(404).json({ error: 'Room not found' });
    const room = roomResult.rows[0];

    if (room.type !== 'public') {
      return res.status(403).json({ error: 'Invite required' });
    }

    // Check not already a member
    const existing = await db.execute({
      sql: 'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?',
      args: [roomId, userId],
    });
    if (existing.rows.length) return res.status(409).json({ error: 'Already a member' });

    await db.execute({
      sql: 'INSERT INTO room_members (room_id, user_id) VALUES (?, ?)',
      args: [roomId, userId],
    });

    res.json({ message: 'Joined room', room });
  } catch (e) {
    console.error('Join room error:', e);
    res.status(500).json({ error: 'Error joining room' });
  }
});

// ────────────────────────────────────────────
// POST /api/rooms/:roomId/leave — Leave a room
// ────────────────────────────────────────────
router.post('/rooms/:roomId/leave', auth, async (req, res) => {
  const roomId = Number(req.params.roomId);
  const userId = req.user.id;

  try {
    const roomResult = await db.execute({ sql: 'SELECT id FROM rooms WHERE id = ?', args: [roomId] });
    if (!roomResult.rows.length) return res.status(404).json({ error: 'Room not found' });

    await db.execute({
      sql: 'DELETE FROM room_members WHERE room_id = ? AND user_id = ?',
      args: [roomId, userId],
    });

    res.json({ message: 'Left room' });
  } catch (e) {
    console.error('Leave room error:', e);
    res.status(500).json({ error: 'Error leaving room' });
  }
});

export default router;
