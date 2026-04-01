import { db } from '../../config/database.js';
import { NotFoundError, ValidationError, AuthorizationError, ConflictError } from '../../errors/index.js';
import { createNotification } from '../notifications/notifications.service.js';

export const RoomInvitesService = {
  async sendInvite(roomId, inviterId, inviteeId) {
    if (!inviteeId) throw new ValidationError('userId is required');
    if (inviteeId === inviterId) throw new ValidationError('Cannot invite yourself');

    const roomResult = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [roomId] });
    if (!roomResult.rows.length) throw new NotFoundError('Room not found');
    const room = roomResult.rows[0];

    if (room.type !== 'public') {
      const roleResult = await db.execute({ sql: 'SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ?', args: [inviterId, roomId] });
      const memberResult = await db.execute({ sql: 'SELECT 1 FROM room_members WHERE user_id = ? AND room_id = ?', args: [inviterId, roomId] });
      const isCreator = room.created_by === inviterId;
      if (!isCreator && !roleResult.rows.length && !memberResult.rows.length) throw new AuthorizationError('You are not a member of this room');
    }

    const inviteeResult = await db.execute({ sql: 'SELECT id, name FROM users WHERE id = ?', args: [inviteeId] });
    if (!inviteeResult.rows.length) throw new NotFoundError('User not found');

    const existingMember = await db.execute({ sql: 'SELECT 1 FROM room_members WHERE user_id = ? AND room_id = ?', args: [inviteeId, roomId] });
    if (existingMember.rows.length) throw new ConflictError('User is already a member of this room');

    const blocked = await db.execute({
      sql: 'SELECT 1 FROM user_blocks WHERE (user_id = ? AND blocked_user_id = ? AND is_active = 1) OR (user_id = ? AND blocked_user_id = ? AND is_active = 1)',
      args: [inviterId, inviteeId, inviteeId, inviterId],
    });
    if (blocked.rows.length) throw new AuthorizationError('Cannot send invite due to block');

    const pendingInvite = await db.execute({ sql: "SELECT 1 FROM room_invites WHERE room_id = ? AND invitee_id = ? AND status = 'pending'", args: [roomId, inviteeId] });
    if (pendingInvite.rows.length) throw new ConflictError('A pending invite already exists for this user');

    await db.execute({ sql: 'INSERT INTO room_invites (room_id, inviter_id, invitee_id) VALUES (?, ?, ?)', args: [roomId, inviterId, inviteeId] });
    createNotification(inviteeId, 'room_invite', 'Room Invite', `You have been invited to join "${room.name}"`, { roomId, inviterId, roomName: room.name }).catch(console.error);
    return { message: 'Invite sent' };
  },

  async getRoomInvites(roomId, user) {
    const roomResult = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [roomId] });
    if (!roomResult.rows.length) throw new NotFoundError('Room not found');
    const room = roomResult.rows[0];
    const isAdmin = user.isAdmin === 1; const isCreator = room.created_by === user.id;
    if (!isAdmin && !isCreator) {
      const roleResult = await db.execute({ sql: "SELECT role FROM user_room_roles WHERE user_id = ? AND room_id = ? AND role IN ('mod', 'owner')", args: [user.id, roomId] });
      if (!roleResult.rows.length) throw new AuthorizationError('Only moderators and owners can view room invites');
    }
    const result = await db.execute({
      sql: `SELECT ri.id, ri.status, ri.created_at, u.id as invitee_id, u.name as invitee_name, u.image as invitee_image, inv.id as inviter_id, inv.name as inviter_name
            FROM room_invites ri JOIN users u ON ri.invitee_id = u.id JOIN users inv ON ri.inviter_id = inv.id WHERE ri.room_id = ? AND ri.status = 'pending' ORDER BY ri.created_at DESC`,
      args: [roomId],
    });
    return result.rows;
  },

  async getUserInvites(userId) {
    const result = await db.execute({
      sql: `SELECT ri.id, ri.room_id, ri.status, ri.created_at, r.name as room_name, r.description as room_description, r.type as room_type, r.language as room_language,
              inv.id as inviter_id, inv.name as inviter_name, inv.image as inviter_image
            FROM room_invites ri JOIN rooms r ON ri.room_id = r.id JOIN users inv ON ri.inviter_id = inv.id WHERE ri.invitee_id = ? AND ri.status = 'pending' ORDER BY ri.created_at DESC`,
      args: [userId],
    });
    return result.rows;
  },

  async acceptInvite(inviteId, userId) {
    const inviteResult = await db.execute({
      sql: "SELECT ri.*, r.name as room_name FROM room_invites ri JOIN rooms r ON ri.room_id = r.id WHERE ri.id = ? AND ri.invitee_id = ? AND ri.status = 'pending'",
      args: [inviteId, userId],
    });
    if (!inviteResult.rows.length) throw new NotFoundError('Invite not found or already responded');
    const invite = inviteResult.rows[0];
    await db.execute({ sql: "UPDATE room_invites SET status = 'accepted', responded_at = CURRENT_TIMESTAMP WHERE id = ?", args: [inviteId] });
    await db.execute({ sql: 'INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)', args: [invite.room_id, userId] });
    const roomResult = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [invite.room_id] });
    return { message: 'Invite accepted', room: roomResult.rows[0] };
  },

  async declineInvite(inviteId, userId) {
    const inviteResult = await db.execute({ sql: "SELECT * FROM room_invites WHERE id = ? AND invitee_id = ? AND status = 'pending'", args: [inviteId, userId] });
    if (!inviteResult.rows.length) throw new NotFoundError('Invite not found or already responded');
    await db.execute({ sql: "UPDATE room_invites SET status = 'declined', responded_at = CURRENT_TIMESTAMP WHERE id = ?", args: [inviteId] });
    return { message: 'Invite declined' };
  },

  async getRoomMembers(roomId) {
    const roomResult = await db.execute({ sql: 'SELECT id FROM rooms WHERE id = ?', args: [roomId] });
    if (!roomResult.rows.length) throw new NotFoundError('Room not found');
    const result = await db.execute({
      sql: `SELECT u.id, u.name, u.image, u.nativelang, u.targetLang, u.level, u.country, rm.joined_at, urr.role
            FROM room_members rm JOIN users u ON rm.user_id = u.id LEFT JOIN user_room_roles urr ON urr.user_id = u.id AND urr.room_id = rm.room_id
            WHERE rm.room_id = ? ORDER BY rm.joined_at ASC`, args: [roomId],
    });
    return result.rows;
  },

  async joinRoom(roomId, userId) {
    const roomResult = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [roomId] });
    if (!roomResult.rows.length) throw new NotFoundError('Room not found');
    if (roomResult.rows[0].type !== 'public') throw new AuthorizationError('Invite required');
    const existing = await db.execute({ sql: 'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?', args: [roomId, userId] });
    if (existing.rows.length) throw new ConflictError('Already a member');
    await db.execute({ sql: 'INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', args: [roomId, userId] });
    return { message: 'Joined room', room: roomResult.rows[0] };
  },

  async leaveRoom(roomId, userId) {
    const roomResult = await db.execute({ sql: 'SELECT id FROM rooms WHERE id = ?', args: [roomId] });
    if (!roomResult.rows.length) throw new NotFoundError('Room not found');
    await db.execute({ sql: 'DELETE FROM room_members WHERE room_id = ? AND user_id = ?', args: [roomId, userId] });
    return { message: 'Left room' };
  },
};
