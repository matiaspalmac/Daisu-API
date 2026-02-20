// db.js — Daisu Language Learning Platform
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config();

const db = createClient({
  url: process.env.DB_URL,
  authToken: process.env.DB_TOKEN,
});

const DEFAULT_ROOMS = [
  { name: 'General', description: 'Sala para todos los idiomas', language: '', level: '', type: 'public', is_default: 1 },
  { name: 'Español A1-A2', description: 'Nivel básico — aprende los fundamentos del español', language: 'es', level: 'A1-A2', type: 'public', is_default: 1 },
  { name: 'Español B1-B2', description: 'Nivel intermedio — conversaciones fluidas', language: 'es', level: 'B1-B2', type: 'public', is_default: 1 },
  { name: 'Español Avanzado', description: 'Nivel C1-C2 — debate y cultura', language: 'es', level: 'C1-C2', type: 'public', is_default: 1 },
  { name: 'English Beginners', description: 'A1-A2 level — learn English basics', language: 'en', level: 'A1-A2', type: 'public', is_default: 1 },
  { name: 'English Intermediate', description: 'B1-B2 — improve your conversational English', language: 'en', level: 'B1-B2', type: 'public', is_default: 1 },
  { name: 'English Advanced', description: 'C1-C2 — debate, culture, idioms', language: 'en', level: 'C1-C2', type: 'public', is_default: 1 },
  { name: 'Português Básico', description: 'A1-A2 — aprenda português do zero', language: 'pt', level: 'A1-A2', type: 'public', is_default: 1 },
  { name: 'Português Avançado', description: 'B1-C1 — conversação fluente', language: 'pt', level: 'B1-C1', type: 'public', is_default: 1 },
];

const DAILY_PROMPTS = {
  es: ['Describe tu comida favorita con 5 oraciones 🍕', 'Habla sobre tu último viaje o el viaje soñado ✈️', 'Explica un chiste de tu país 😄', '¿Qué serie estás viendo? ¿Por qué la recomiendas? 📺', 'Describe tu ciudad en 3 palabras 🌆'],
  en: ['Describe your favorite meal in 5 sentences 🍕', 'Talk about your last trip or dream destination ✈️', 'Tell a joke from your country 😄', 'What series are you watching? Why do you recommend it? 📺', 'Describe your city in 3 words 🌆'],
  pt: ['Descreva sua comida favorita em 5 frases 🍕', 'Fale sobre sua última viagem ou destino dos sonhos ✈️', 'Conte uma piada do seu país 😄', 'Que série você está vendo? Por que recomenda? 📺', 'Descreva sua cidade em 3 palavras 🌆'],
};

async function createTables() {
  try {
    // Users
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT,
        image TEXT DEFAULT '',
        cover_image TEXT DEFAULT '',
        isAdmin INTEGER DEFAULT 0,
        banned_at TIMESTAMP,
        bio TEXT DEFAULT '',
        nativelang TEXT DEFAULT '',
        learninglang TEXT DEFAULT '',
        targetLang TEXT DEFAULT '',
        level TEXT DEFAULT 'A1',
        country TEXT DEFAULT '',
        interests TEXT DEFAULT '[]',
        tandem_goal TEXT DEFAULT '',
        streak INTEGER DEFAULT 0,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add missing columns to users if they don't exist (migration)
    const userCols = ['targetLang TEXT DEFAULT ""', 'level TEXT DEFAULT "A1"', 'country TEXT DEFAULT ""',
      'interests TEXT DEFAULT "[]"', 'tandem_goal TEXT DEFAULT ""', 'streak INTEGER DEFAULT 0',
      'cover_image TEXT DEFAULT ""', 'banned_at TIMESTAMP', 'last_active TIMESTAMP'];
    for (const col of userCols) {
      try { await db.execute(`ALTER TABLE users ADD COLUMN ${col}`); } catch (_) { /* already exists */ }
    }

    // Rooms
    await db.execute(`
      CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        language TEXT DEFAULT '',
        level TEXT DEFAULT '',
        type TEXT DEFAULT 'public',
        is_default INTEGER DEFAULT 0,
        daily_prompt TEXT DEFAULT '',
        prompt_updated_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add missing columns to rooms
    const roomCols = ['language TEXT DEFAULT ""', 'level TEXT DEFAULT ""', 'type TEXT DEFAULT "public"',
      'is_default INTEGER DEFAULT 0', 'daily_prompt TEXT DEFAULT ""', 'prompt_updated_at TIMESTAMP', 'description TEXT DEFAULT ""'];
    for (const col of roomCols) {
      try { await db.execute(`ALTER TABLE rooms ADD COLUMN ${col}`); } catch (_) { /* already exists */ }
    }

    // Messages
    await db.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        room_id INTEGER NOT NULL,
        detected_lang TEXT DEFAULT '',
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      )
    `);
    try { await db.execute('ALTER TABLE messages ADD COLUMN detected_lang TEXT DEFAULT ""'); } catch (_) { }

    // Reactions
    await db.execute(`
      CREATE TABLE IF NOT EXISTS reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        emoji TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(message_id, user_id, emoji),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Reports
    await db.execute(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        reporter_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        notes TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // User stats
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_stats (
        user_id INTEGER PRIMARY KEY,
        messages_sent INTEGER DEFAULT 0,
        words_sent INTEGER DEFAULT 0,
        corrections_given INTEGER DEFAULT 0,
        streak INTEGER DEFAULT 0,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Seed default rooms
    for (const room of DEFAULT_ROOMS) {
      await db.execute({
        sql: 'INSERT OR IGNORE INTO rooms (name, description, language, level, type, is_default) VALUES (?, ?, ?, ?, ?, ?)',
        args: [room.name, room.description, room.language, room.level, room.type, room.is_default],
      });
    }

    // Set daily prompts for language rooms
    for (const [lang, prompts] of Object.entries(DAILY_PROMPTS)) {
      const prompt = prompts[new Date().getDay() % prompts.length];
      await db.execute({
        sql: `UPDATE rooms SET daily_prompt = ?, prompt_updated_at = CURRENT_TIMESTAMP WHERE language = ? AND daily_prompt = ''`,
        args: [prompt, lang],
      });
    }

    console.log('✅ DB tables created / migrated and rooms seeded');
  } catch (e) {
    console.error('Error in createTables:', e);
  }
}

export { db, createTables, DAILY_PROMPTS };