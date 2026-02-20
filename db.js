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

    // Private chat invites
    await db.execute(`
      CREATE TABLE IF NOT EXISTS private_chat_invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user_id INTEGER NOT NULL,
        to_user_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        responded_at TIMESTAMP,
        rejected_at TIMESTAMP,
        FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    try { await db.execute('ALTER TABLE private_chat_invites ADD COLUMN responded_at TIMESTAMP'); } catch (_) { }
    try { await db.execute('ALTER TABLE private_chat_invites ADD COLUMN rejected_at TIMESTAMP'); } catch (_) { }
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_private_invites_pair ON private_chat_invites(from_user_id, to_user_id, created_at)'); } catch (_) { }

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

    // Chat UI settings per user
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_chat_settings (
        user_id INTEGER PRIMARY KEY,
        bubble_theme TEXT DEFAULT 'neon',
        my_bubble_color TEXT DEFAULT '#2d88ff',
        other_bubble_color TEXT DEFAULT '#1e2430',
        font_size TEXT DEFAULT 'medium',
        effects_enabled INTEGER DEFAULT 1,
        text_only_mode INTEGER DEFAULT 0,
        data_saver_mode INTEGER DEFAULT 0,
        disable_profile_images INTEGER DEFAULT 0,
        room_backgrounds TEXT DEFAULT '{}',
        nicknames TEXT DEFAULT '{}',
        last_room_id TEXT DEFAULT '',
        room_drafts TEXT DEFAULT '{}',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    try { await db.execute('ALTER TABLE user_chat_settings ADD COLUMN bubble_theme TEXT DEFAULT "neon"'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_chat_settings ADD COLUMN my_bubble_color TEXT DEFAULT "#2d88ff"'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_chat_settings ADD COLUMN other_bubble_color TEXT DEFAULT "#1e2430"'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_chat_settings ADD COLUMN font_size TEXT DEFAULT "medium"'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_chat_settings ADD COLUMN effects_enabled INTEGER DEFAULT 1'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_chat_settings ADD COLUMN text_only_mode INTEGER DEFAULT 0'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_chat_settings ADD COLUMN data_saver_mode INTEGER DEFAULT 0'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_chat_settings ADD COLUMN disable_profile_images INTEGER DEFAULT 0'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_chat_settings ADD COLUMN room_backgrounds TEXT DEFAULT "{}"'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_chat_settings ADD COLUMN nicknames TEXT DEFAULT "{}"'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_chat_settings ADD COLUMN last_room_id TEXT DEFAULT ""'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_chat_settings ADD COLUMN room_drafts TEXT DEFAULT "{}"'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_chat_settings ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP'); } catch (_) { }

    // Personal moderation (mute/block) between users
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_moderation (
        user_id INTEGER NOT NULL,
        target_user_id INTEGER NOT NULL,
        muted INTEGER DEFAULT 0,
        blocked INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, target_user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    try { await db.execute('ALTER TABLE user_moderation ADD COLUMN muted INTEGER DEFAULT 0'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_moderation ADD COLUMN blocked INTEGER DEFAULT 0'); } catch (_) { }
    try { await db.execute('ALTER TABLE user_moderation ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP'); } catch (_) { }
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_user_moderation_user ON user_moderation(user_id)'); } catch (_) { }

    // User-Room Roles (user/mod/owner)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_room_roles (
        user_id INTEGER NOT NULL,
        room_id INTEGER NOT NULL,
        role TEXT DEFAULT 'user',
        assigned_by INTEGER,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, room_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_user_room_roles_room ON user_room_roles(room_id)'); } catch (_) { }

    // Pinned Messages
    await db.execute(`
      CREATE TABLE IF NOT EXISTS pinned_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        room_id INTEGER NOT NULL,
        pinned_by INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(message_id, room_id),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (pinned_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Mentions in Messages
    await db.execute(`
      CREATE TABLE IF NOT EXISTS mentions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        mentioned_user_id INTEGER NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (mentioned_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_mentions_user ON mentions(mentioned_user_id, is_read)'); } catch (_) { }

    // Room Bans with expiration
    await db.execute(`
      CREATE TABLE IF NOT EXISTS room_bans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        room_id INTEGER NOT NULL,
        banned_by INTEGER NOT NULL,
        reason TEXT DEFAULT '',
        expires_at TIMESTAMP,
        is_permanent INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, room_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_room_bans_expiry ON room_bans(expires_at)'); } catch (_) { }

    // User Favorite Emojis
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_emoji_favorites (
        user_id INTEGER NOT NULL,
        emoji TEXT NOT NULL,
        count INTEGER DEFAULT 1,
        last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, emoji),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Moderator Actions Audit Log
    await db.execute(`
      CREATE TABLE IF NOT EXISTS moderator_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mod_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        target_user_id INTEGER,
        room_id INTEGER,
        details TEXT DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (mod_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
      )
    `);
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_mod_actions_mod ON moderator_actions(mod_id)'); } catch (_) { }
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_mod_actions_target ON moderator_actions(target_user_id)'); } catch (_) { }
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_mod_actions_room ON moderator_actions(room_id)'); } catch (_) { }

    // Social Features: Followers
    await db.execute(`
      CREATE TABLE IF NOT EXISTS follows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        follower_id INTEGER NOT NULL,
        following_id INTEGER NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(follower_id, following_id)
      )
    `);
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id)'); } catch (_) { }
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id)'); } catch (_) { }

    // Social Features: User Blocks
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        blocked_user_id INTEGER NOT NULL,
        is_active INTEGER DEFAULT 1,
        blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, blocked_user_id)
      )
    `);
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_blocks_user ON user_blocks(user_id)'); } catch (_) { }
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON user_blocks(blocked_user_id)'); } catch (_) { }

    // Social Features: Profile Views
    await db.execute(`
      CREATE TABLE IF NOT EXISTS profile_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_owner_id INTEGER NOT NULL,
        viewer_id INTEGER NOT NULL,
        viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (profile_owner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_profile_views_owner ON profile_views(profile_owner_id)'); } catch (_) { }
    try { await db.execute('CREATE INDEX IF NOT EXISTS idx_profile_views_viewer ON profile_views(viewer_id)'); } catch (_) { }

    // Add privacy and customization columns to users table
    const privacyColumns = [
      'is_public INTEGER DEFAULT 1',
      'hide_old_messages INTEGER DEFAULT 0',
      'bubble_color TEXT DEFAULT "#2d88ff"'
    ];
    for (const col of privacyColumns) {
      try { await db.execute(`ALTER TABLE users ADD COLUMN ${col}`); } catch (_) { /* already exists */ }
    }

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