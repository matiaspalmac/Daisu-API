// routes/chats.js
import express from 'express';
import { db } from '../db.js';

const router = express.Router();

// GET /api/rooms — with language/level/type filters
router.get('/rooms', async (req, res) => {
  const { language, level, type } = req.query;
  try {
    let sql = `
      SELECT r.id, r.name, r.description, r.language, r.level, r.type, r.is_default,
             r.daily_prompt, r.created_at,
             (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id) as message_count
      FROM rooms r WHERE 1=1
    `;
    const args = [];
    if (language) { sql += ' AND r.language = ?'; args.push(language); }
    if (level) { sql += ' AND r.level = ?'; args.push(level); }
    if (type) { sql += ' AND r.type = ?'; args.push(type); }
    sql += ' ORDER BY r.is_default DESC, r.created_at ASC';

    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (e) {
    console.error('Error fetching rooms:', e);
    res.status(500).json({ error: 'Error fetching rooms' });
  }
});

// GET /api/rooms/:id — single room
router.get('/rooms/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM rooms WHERE id = ?', args: [id],
    });
    if (!result.rows.length) return res.status(404).json({ error: 'Room not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Error fetching room' });
  }
});

// POST /api/rooms
router.post('/rooms', async (req, res) => {
  const { name, description, language, level, type } = req.body;
  if (!name) return res.status(400).json({ error: 'Room name is required' });
  try {
    const exists = await db.execute({ sql: 'SELECT id FROM rooms WHERE name = ?', args: [name] });
    if (exists.rows.length > 0) return res.status(409).json({ error: 'Room already exists' });

    const result = await db.execute({
      sql: 'INSERT INTO rooms (name, description, language, level, type) VALUES (?, ?, ?, ?, ?)',
      args: [name, description || '', language || '', level || '', type || 'public'],
    });
    res.status(201).json({
      id: result.lastInsertRowid.toString(), name,
      description: description || '', language: language || '',
      level: level || '', type: type || 'public', is_default: 0, message_count: 0,
    });
  } catch (e) {
    console.error('Error creating room:', e);
    res.status(500).json({ error: 'Error creating room' });
  }
});

// PATCH /api/rooms/:id — update room
router.patch('/rooms/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, language, level, type, daily_prompt } = req.body;
  try {
    await db.execute({
      sql: `UPDATE rooms SET name = COALESCE(?, name), description = COALESCE(?, description),
            language = COALESCE(?, language), level = COALESCE(?, level), type = COALESCE(?, type),
            daily_prompt = COALESCE(?, daily_prompt) WHERE id = ?`,
      args: [name, description, language, level, type, daily_prompt, id],
    });
    res.json({ message: 'Room updated' });
  } catch (e) {
    res.status(500).json({ error: 'Error updating room' });
  }
});

// DELETE /api/rooms/:id
router.delete('/rooms/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.execute({ sql: 'DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)', args: [id] });
    await db.execute({ sql: 'DELETE FROM messages WHERE room_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM rooms WHERE id = ?', args: [id] });
    res.json({ message: 'Room deleted' });
  } catch (e) {
    console.error('Error deleting room:', e);
    res.status(500).json({ error: 'Error deleting room' });
  }
});

// GET /api/chats — messages with filters
router.get('/chats', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 200);
  const offset = parseInt(req.query.offset) || 0;
  const roomId = req.query.room_id;
  try {
    let sql = `
      SELECT m.id, m.content, m.user_id, u.name as user_name, u.image as user_image,
             m.room_id, r.name as room_name, m.sent_at
      FROM messages m JOIN users u ON m.user_id = u.id JOIN rooms r ON m.room_id = r.id WHERE 1=1
    `;
    const args = [];
    if (roomId) { sql += ' AND m.room_id = ?'; args.push(roomId); }
    sql += ' ORDER BY m.sent_at DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    const result = await db.execute({ sql, args });
    res.json(result.rows.map(row => ({
      id: row.id, content: row.content,
      user: { id: row.user_id, name: row.user_name, image: row.user_image },
      room: { id: row.room_id, name: row.room_name },
      sent_at: row.sent_at,
    })));
  } catch (e) {
    console.error('Error fetching chats:', e);
    res.status(500).json({ error: 'Error fetching messages' });
  }
});

// GET /api/stats — dashboard aggregate stats
router.get('/stats', async (_, res) => {
  try {
    const [users, rooms, messages] = await Promise.all([
      db.execute('SELECT COUNT(*) as count FROM users'),
      db.execute('SELECT COUNT(*) as count FROM rooms'),
      db.execute('SELECT COUNT(*) as count FROM messages'),
    ]);
    res.json({
      users: users.rows[0].count,
      rooms: rooms.rows[0].count,
      messages: messages.rows[0].count,
    });
  } catch (e) {
    res.status(500).json({ error: 'Error fetching stats' });
  }
});

export default router;