import { db } from '../../config/database.js';
import { NotFoundError, ValidationError, AuthorizationError, ConflictError } from '../../errors/index.js';
import { createNotification } from '../notifications/notifications.service.js';
import { checkAndGrantAchievements } from '../achievements/achievements.service.js';

const VALID_EVENT_TYPES = ['session', 'workshop', 'challenge', 'meetup', 'ama'];
const VALID_EVENT_STATUSES = ['scheduled', 'live', 'completed', 'cancelled'];

export const EventsService = {
  async listMyEvents(userId) {
    const result = await db.execute({
      sql: `SELECT e.*, u.name as host_name, u.image as host_image,
                   (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id AND status != 'cancelled') as attendee_count,
                   CASE WHEN e.host_user_id = ? THEN 'hosting' ELSE ea.status END as my_status
            FROM events e LEFT JOIN event_attendees ea ON ea.event_id = e.id AND ea.user_id = ?
            JOIN users u ON e.host_user_id = u.id
            WHERE (e.host_user_id = ? OR ea.user_id = ?) AND e.status != 'cancelled' ORDER BY e.starts_at ASC`,
      args: [userId, userId, userId, userId],
    });
    return { events: result.rows };
  },

  async list(query) {
    const { language, type, host_user_id } = query;
    const conditions = ["(e.status = 'scheduled' OR e.status = 'live')", "e.starts_at > datetime('now', '-1 day')"];
    const args = [];
    if (language) { conditions.push('e.language = ?'); args.push(language); }
    if (type) { conditions.push('e.type = ?'); args.push(type); }
    if (host_user_id) { conditions.push('e.host_user_id = ?'); args.push(host_user_id); }
    const where = conditions.join(' AND ');
    const result = await db.execute({
      sql: `SELECT e.*, u.name as host_name, u.image as host_image,
                   (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id AND status != 'cancelled') as attendee_count
            FROM events e JOIN users u ON e.host_user_id = u.id WHERE ${where} ORDER BY e.starts_at ASC`, args,
    });
    return { events: result.rows };
  },

  async getById(id) {
    const eventResult = await db.execute({
      sql: `SELECT e.*, u.name as host_name, u.image as host_image,
                   (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id AND status != 'cancelled') as attendee_count
            FROM events e JOIN users u ON e.host_user_id = u.id WHERE e.id = ?`, args: [id],
    });
    if (!eventResult.rows.length) throw new NotFoundError('Event not found');
    const attendeesResult = await db.execute({
      sql: `SELECT ea.status, ea.registered_at, u.id as user_id, u.name, u.image, u.level
            FROM event_attendees ea JOIN users u ON ea.user_id = u.id
            WHERE ea.event_id = ? AND ea.status != 'cancelled' ORDER BY ea.registered_at ASC`, args: [id],
    });
    return { event: eventResult.rows[0], attendees: attendeesResult.rows };
  },

  async create(hostId, data) {
    const { title, description, type, language, level, room_id, max_attendees, starts_at, ends_at, timezone, is_recurring, recurrence_rule, is_premium } = data;
    const safeType = VALID_EVENT_TYPES.includes(type) ? type : 'session';
    const result = await db.execute({
      sql: `INSERT INTO events (title, description, type, language, level, host_user_id, room_id, max_attendees,
                                starts_at, ends_at, timezone, is_recurring, recurrence_rule, is_premium, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', CURRENT_TIMESTAMP)`,
      args: [title, description || '', safeType, language || '', level || '', hostId, room_id || null, max_attendees || 0,
        starts_at, ends_at || null, timezone || 'UTC', is_recurring ? 1 : 0, recurrence_rule || null, is_premium ? 1 : 0],
    });
    const created = await db.execute({ sql: 'SELECT * FROM events WHERE id = ?', args: [result.lastInsertRowid.toString()] });
    return { event: created.rows[0] };
  },

  async update(id, data, user) {
    const existing = await db.execute({ sql: 'SELECT * FROM events WHERE id = ?', args: [id] });
    if (!existing.rows.length) throw new NotFoundError('Event not found');
    if (String(existing.rows[0].host_user_id) !== String(user.id) && !user.isAdmin) throw new AuthorizationError('Only the host or an admin can update this event');

    const event = existing.rows[0];
    const { title, description, type, language, level, room_id, max_attendees, starts_at, ends_at, timezone, is_recurring, recurrence_rule, status, is_premium } = data;
    await db.execute({
      sql: `UPDATE events SET title = ?, description = ?, type = ?, language = ?, level = ?,
              room_id = ?, max_attendees = ?, starts_at = ?, ends_at = ?, timezone = ?, is_recurring = ?,
              recurrence_rule = ?, status = ?, is_premium = ? WHERE id = ?`,
      args: [title || event.title, description !== undefined ? description : event.description,
        VALID_EVENT_TYPES.includes(type) ? type : event.type, language !== undefined ? language : event.language,
        level !== undefined ? level : event.level, room_id !== undefined ? room_id : event.room_id,
        max_attendees !== undefined ? max_attendees : event.max_attendees, starts_at || event.starts_at,
        ends_at !== undefined ? ends_at : event.ends_at, timezone || event.timezone,
        is_recurring !== undefined ? (is_recurring ? 1 : 0) : event.is_recurring,
        recurrence_rule !== undefined ? recurrence_rule : event.recurrence_rule,
        VALID_EVENT_STATUSES.includes(status) ? status : event.status,
        is_premium !== undefined ? (is_premium ? 1 : 0) : event.is_premium, id],
    });
    const updated = await db.execute({ sql: 'SELECT * FROM events WHERE id = ?', args: [id] });
    return { event: updated.rows[0] };
  },

  async cancel(id, user) {
    const existing = await db.execute({ sql: 'SELECT * FROM events WHERE id = ?', args: [id] });
    if (!existing.rows.length) throw new NotFoundError('Event not found');
    if (String(existing.rows[0].host_user_id) !== String(user.id) && !user.isAdmin) throw new AuthorizationError('Only the host or an admin can cancel this event');
    await db.execute({ sql: "UPDATE events SET status = 'cancelled' WHERE id = ?", args: [id] });
    return { message: 'Event cancelled' };
  },

  async register(userId, eventId) {
    const eventResult = await db.execute({ sql: 'SELECT * FROM events WHERE id = ?', args: [eventId] });
    if (!eventResult.rows.length) throw new NotFoundError('Event not found');
    const event = eventResult.rows[0];
    if (event.status === 'cancelled') throw new ValidationError('Cannot register for a cancelled event');
    if (event.status === 'completed') throw new ValidationError('Cannot register for a completed event');

    if (event.is_premium) {
      const userResult = await db.execute({ sql: 'SELECT membership_tier FROM users WHERE id = ?', args: [userId] });
      const tier = userResult.rows[0]?.membership_tier || 'free';
      if (tier !== 'pro' && tier !== 'premium') throw new AuthorizationError('This event requires a pro or premium membership');
    }
    if (event.max_attendees > 0) {
      const countResult = await db.execute({ sql: "SELECT COUNT(*) as count FROM event_attendees WHERE event_id = ? AND status != 'cancelled'", args: [eventId] });
      if (Number(countResult.rows[0].count) >= event.max_attendees) throw new ConflictError('Event is full');
    }

    await db.execute({
      sql: `INSERT INTO event_attendees (event_id, user_id, status, registered_at) VALUES (?, ?, 'registered', CURRENT_TIMESTAMP)
            ON CONFLICT(event_id, user_id) DO UPDATE SET status = 'registered', registered_at = CURRENT_TIMESTAMP`,
      args: [eventId, userId],
    });

    if (String(event.host_user_id) !== String(userId)) {
      const attendeeRes = await db.execute({ sql: 'SELECT name FROM users WHERE id = ?', args: [userId] });
      const attendeeName = attendeeRes.rows[0]?.name || 'Someone';
      createNotification(event.host_user_id, 'event_reminder', 'New registration', `${attendeeName} registered for "${event.title}"`, { eventId: Number(eventId), eventTitle: event.title, attendeeName }).catch(console.error);
    }
    checkAndGrantAchievements(userId).catch(console.error);
    return { message: 'Registered for event' };
  },

  async unregister(userId, eventId) {
    const existing = await db.execute({ sql: 'SELECT * FROM event_attendees WHERE event_id = ? AND user_id = ?', args: [eventId, userId] });
    if (!existing.rows.length) throw new NotFoundError('Registration not found');
    await db.execute({ sql: "UPDATE event_attendees SET status = 'cancelled' WHERE event_id = ? AND user_id = ?", args: [eventId, userId] });
    return { message: 'Registration cancelled' };
  },
};
