// routes/events.js
import express from 'express';
import { db } from '../../config/database.js';
import { auth, adminOnly } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import { createEventSchema } from './events.schemas.js';
import { createNotification } from '../notifications/notifications.service.js';
import { checkAndGrantAchievements } from '../achievements/achievements.service.js';

const router = express.Router();

// GET /api/events/my — events the user is registered for or hosting
router.get('/events/my', auth, async (req, res) => {
    const userId = req.user.id;

    try {
        const result = await db.execute({
            sql: `SELECT e.*, u.name as host_name, u.image as host_image,
                         (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id AND status != 'cancelled') as attendee_count,
                         CASE
                           WHEN e.host_user_id = ? THEN 'hosting'
                           ELSE ea.status
                         END as my_status
                  FROM events e
                  LEFT JOIN event_attendees ea ON ea.event_id = e.id AND ea.user_id = ?
                  JOIN users u ON e.host_user_id = u.id
                  WHERE (e.host_user_id = ? OR ea.user_id = ?)
                    AND e.status != 'cancelled'
                  ORDER BY e.starts_at ASC`,
            args: [userId, userId, userId, userId],
        });

        res.json({ events: result.rows });
    } catch (e) {
        console.error('My events error:', e);
        res.status(500).json({ error: 'Error fetching your events' });
    }
});

// GET /api/events — list upcoming events
router.get('/events', auth, async (req, res) => {
    const { language, type, host_user_id } = req.query;

    try {
        const conditions = ["(e.status = 'scheduled' OR e.status = 'live')", "e.starts_at > datetime('now', '-1 day')"];
        const args = [];

        if (language) {
            conditions.push('e.language = ?');
            args.push(language);
        }
        if (type) {
            conditions.push('e.type = ?');
            args.push(type);
        }
        if (host_user_id) {
            conditions.push('e.host_user_id = ?');
            args.push(host_user_id);
        }

        const where = conditions.join(' AND ');

        const result = await db.execute({
            sql: `SELECT e.*, u.name as host_name, u.image as host_image,
                         (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id AND status != 'cancelled') as attendee_count
                  FROM events e
                  JOIN users u ON e.host_user_id = u.id
                  WHERE ${where}
                  ORDER BY e.starts_at ASC`,
            args,
        });

        res.json({ events: result.rows });
    } catch (e) {
        console.error('Events list error:', e);
        res.status(500).json({ error: 'Error fetching events' });
    }
});

// GET /api/events/:id — event detail with attendees
router.get('/events/:id', auth, async (req, res) => {
    const { id } = req.params;

    try {
        const eventResult = await db.execute({
            sql: `SELECT e.*, u.name as host_name, u.image as host_image,
                         (SELECT COUNT(*) FROM event_attendees WHERE event_id = e.id AND status != 'cancelled') as attendee_count
                  FROM events e
                  JOIN users u ON e.host_user_id = u.id
                  WHERE e.id = ?`,
            args: [id],
        });
        if (!eventResult.rows.length) return res.status(404).json({ error: 'Event not found' });

        const attendeesResult = await db.execute({
            sql: `SELECT ea.status, ea.registered_at, u.id as user_id, u.name, u.image, u.level
                  FROM event_attendees ea
                  JOIN users u ON ea.user_id = u.id
                  WHERE ea.event_id = ? AND ea.status != 'cancelled'
                  ORDER BY ea.registered_at ASC`,
            args: [id],
        });

        res.json({ event: eventResult.rows[0], attendees: attendeesResult.rows });
    } catch (e) {
        console.error('Event detail error:', e);
        res.status(500).json({ error: 'Error fetching event' });
    }
});

// POST /api/events — create event
router.post('/events', auth, validate(createEventSchema), async (req, res) => {
    const hostId = req.user.id;
    const { title, description, type, language, level, room_id, max_attendees, starts_at, ends_at, timezone, is_recurring, recurrence_rule, is_premium } = req.body;

    if (!title || !starts_at) {
        return res.status(400).json({ error: 'title and starts_at are required' });
    }

    const validTypes = ['session', 'workshop', 'challenge', 'meetup', 'ama'];
    const safeType = validTypes.includes(type) ? type : 'session';

    try {
        const result = await db.execute({
            sql: `INSERT INTO events (title, description, type, language, level, host_user_id, room_id, max_attendees,
                                      starts_at, ends_at, timezone, is_recurring, recurrence_rule, is_premium, status, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', CURRENT_TIMESTAMP)`,
            args: [
                title,
                description || '',
                safeType,
                language || '',
                level || '',
                hostId,
                room_id || null,
                max_attendees || 0,
                starts_at,
                ends_at || null,
                timezone || 'UTC',
                is_recurring ? 1 : 0,
                recurrence_rule || null,
                is_premium ? 1 : 0,
            ],
        });

        const eventId = result.lastInsertRowid.toString();
        const created = await db.execute({
            sql: 'SELECT * FROM events WHERE id = ?',
            args: [eventId],
        });

        res.status(201).json({ event: created.rows[0] });
    } catch (e) {
        console.error('Event create error:', e);
        res.status(500).json({ error: 'Error creating event' });
    }
});

// PUT /api/events/:id — update event (host or admin only)
router.put('/events/:id', auth, async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    const { title, description, type, language, level, room_id, max_attendees, starts_at, ends_at, timezone, is_recurring, recurrence_rule, status, is_premium } = req.body;

    try {
        const existing = await db.execute({
            sql: 'SELECT * FROM events WHERE id = ?',
            args: [id],
        });
        if (!existing.rows.length) return res.status(404).json({ error: 'Event not found' });

        if (String(existing.rows[0].host_user_id) !== String(userId) && !req.user.isAdmin) {
            return res.status(403).json({ error: 'Only the host or an admin can update this event' });
        }

        const validTypes = ['session', 'workshop', 'challenge', 'meetup', 'ama'];
        const validStatuses = ['scheduled', 'live', 'completed', 'cancelled'];
        const event = existing.rows[0];

        await db.execute({
            sql: `UPDATE events SET
                    title = ?, description = ?, type = ?, language = ?, level = ?,
                    room_id = ?, max_attendees = ?, starts_at = ?, ends_at = ?,
                    timezone = ?, is_recurring = ?, recurrence_rule = ?, status = ?, is_premium = ?
                  WHERE id = ?`,
            args: [
                title || event.title,
                description !== undefined ? description : event.description,
                validTypes.includes(type) ? type : event.type,
                language !== undefined ? language : event.language,
                level !== undefined ? level : event.level,
                room_id !== undefined ? room_id : event.room_id,
                max_attendees !== undefined ? max_attendees : event.max_attendees,
                starts_at || event.starts_at,
                ends_at !== undefined ? ends_at : event.ends_at,
                timezone || event.timezone,
                is_recurring !== undefined ? (is_recurring ? 1 : 0) : event.is_recurring,
                recurrence_rule !== undefined ? recurrence_rule : event.recurrence_rule,
                validStatuses.includes(status) ? status : event.status,
                is_premium !== undefined ? (is_premium ? 1 : 0) : event.is_premium,
                id,
            ],
        });

        const updated = await db.execute({
            sql: 'SELECT * FROM events WHERE id = ?',
            args: [id],
        });

        res.json({ event: updated.rows[0] });
    } catch (e) {
        console.error('Event update error:', e);
        res.status(500).json({ error: 'Error updating event' });
    }
});

// DELETE /api/events/:id — cancel event (host or admin only)
router.delete('/events/:id', auth, async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    try {
        const existing = await db.execute({
            sql: 'SELECT * FROM events WHERE id = ?',
            args: [id],
        });
        if (!existing.rows.length) return res.status(404).json({ error: 'Event not found' });

        if (String(existing.rows[0].host_user_id) !== String(userId) && !req.user.isAdmin) {
            return res.status(403).json({ error: 'Only the host or an admin can cancel this event' });
        }

        await db.execute({
            sql: "UPDATE events SET status = 'cancelled' WHERE id = ?",
            args: [id],
        });

        res.json({ message: 'Event cancelled' });
    } catch (e) {
        console.error('Event cancel error:', e);
        res.status(500).json({ error: 'Error cancelling event' });
    }
});

// POST /api/events/:id/register — register for an event
router.post('/events/:id/register', auth, async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    try {
        const eventResult = await db.execute({
            sql: 'SELECT * FROM events WHERE id = ?',
            args: [id],
        });
        if (!eventResult.rows.length) return res.status(404).json({ error: 'Event not found' });

        const event = eventResult.rows[0];

        if (event.status === 'cancelled') {
            return res.status(400).json({ error: 'Cannot register for a cancelled event' });
        }
        if (event.status === 'completed') {
            return res.status(400).json({ error: 'Cannot register for a completed event' });
        }

        // Check premium requirement
        if (event.is_premium) {
            const userResult = await db.execute({
                sql: 'SELECT membership_tier FROM users WHERE id = ?',
                args: [userId],
            });
            const tier = userResult.rows[0]?.membership_tier || 'free';
            if (tier !== 'pro' && tier !== 'premium') {
                return res.status(403).json({ error: 'This event requires a pro or premium membership' });
            }
        }

        // Check max attendees
        if (event.max_attendees > 0) {
            const countResult = await db.execute({
                sql: "SELECT COUNT(*) as count FROM event_attendees WHERE event_id = ? AND status != 'cancelled'",
                args: [id],
            });
            if (Number(countResult.rows[0].count) >= event.max_attendees) {
                return res.status(409).json({ error: 'Event is full' });
            }
        }

        await db.execute({
            sql: `INSERT INTO event_attendees (event_id, user_id, status, registered_at)
                  VALUES (?, ?, 'registered', CURRENT_TIMESTAMP)
                  ON CONFLICT(event_id, user_id) DO UPDATE SET
                    status = 'registered',
                    registered_at = CURRENT_TIMESTAMP`,
            args: [id, userId],
        });

        // Fire-and-forget notification to the event host
        if (String(event.host_user_id) !== String(userId)) {
            const attendeeRes = await db.execute({ sql: 'SELECT name FROM users WHERE id = ?', args: [userId] });
            const attendeeName = attendeeRes.rows[0]?.name || 'Someone';
            createNotification(
                event.host_user_id,
                'event_reminder',
                'New registration',
                `${attendeeName} registered for "${event.title}"`,
                { eventId: Number(id), eventTitle: event.title, attendeeName }
            ).catch(console.error);
        }

        // Note: events_attended achievements require status = 'attended', not just 'registered'.
        // This call is safe here but will only grant events_attended achievements once
        // an attendee's status is updated to 'attended' elsewhere.
        checkAndGrantAchievements(userId).catch(console.error);

        res.status(201).json({ message: 'Registered for event' });
    } catch (e) {
        console.error('Event register error:', e);
        res.status(500).json({ error: 'Error registering for event' });
    }
});

// POST /api/events/:id/unregister — cancel registration
router.post('/events/:id/unregister', auth, async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    try {
        const existing = await db.execute({
            sql: 'SELECT * FROM event_attendees WHERE event_id = ? AND user_id = ?',
            args: [id, userId],
        });
        if (!existing.rows.length) {
            return res.status(404).json({ error: 'Registration not found' });
        }

        await db.execute({
            sql: "UPDATE event_attendees SET status = 'cancelled' WHERE event_id = ? AND user_id = ?",
            args: [id, userId],
        });

        res.json({ message: 'Registration cancelled' });
    } catch (e) {
        console.error('Event unregister error:', e);
        res.status(500).json({ error: 'Error cancelling registration' });
    }
});

export default router;
