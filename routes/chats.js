import express from 'express';
import { db } from '../db.js';

const router = express.Router();

// Get rooms
router.get('/rooms', async (_, res) => {
  console.log('Fetching all rooms');
  try {
    const result = await db.execute('SELECT id, name, created_at FROM rooms');
    res.json(result.rows);
  } catch (e) {
    console.error('Error fetching rooms:', e);
    res.status(500).json({ error: 'Error fetching rooms' });
  }
});

// Create Room
router.post('/rooms', async (req, res) => {
  console.log('Creating room:', req.body);
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Room name is required' });
  }

  try {
    const roomExists = await db.execute({
      sql: 'SELECT id FROM rooms WHERE name = ?',
      args: [name],
    });

    if (roomExists.rows.length > 0) {
      return res.status(409).json({ error: 'Room already exists' });
    }
    
    const result = await db.execute({ 
      sql: 'INSERT INTO rooms (name) VALUES (?)',
      args: [name],
    });

    console.log(result)

    res.status(201).json({ 
      message: 'Room added successfully', 
      roomId: result.lastInsertRowid.toString() 
    });

  } catch (e) {
    console.error('Error adding room:', e);
    res.status(500).json({ error: 'Error adding room' });
  }
});

// Get chats (messages)
router.get('/chats', async (req, res) => {
  console.log('Fetching all chats');
  try { 
    const result = await db.execute(`
      SELECT m.id, m.content, m.user_id, u.name as user_name, m.room_id, r.name as room_name, m.sent_at
      FROM messages m
      JOIN users u ON m.user_id = u.id
      JOIN rooms r ON m.room_id = r.id
      ORDER BY m.sent_at DESC
      LIMIT 100
    `);
      
    if (!result.rows || result.rows.length === 0) {
      return res.json([]); 
    }

    const chats = result.rows.map(row => ({
      id: row.id,
      content: row.content,
      user: {
        id: row.user_id,
        name: row.user_name,
      },
      room: {
        id: row.room_id,
        name: row.room_name
      },
      sent_at: new Date(row.sent_at).toISOString()
    }));

    res.json(chats);
  } catch (e) {
    console.error('Error fetching messages:', e);
    res.status(500).json({ error: 'Error fetching messages' });
  }
});

export default router;