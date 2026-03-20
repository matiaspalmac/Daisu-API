export const DEFAULT_ACHIEVEMENTS = [
  // Chat
  { id: 'first_message', name: 'First Words', description: 'Send your first message', icon: '💬', category: 'chat', xp_reward: 10, requirement_type: 'messages_sent', requirement_value: 1 },
  { id: 'chatterbox_100', name: 'Chatterbox', description: 'Send 100 messages', icon: '🗣️', category: 'chat', xp_reward: 50, requirement_type: 'messages_sent', requirement_value: 100 },
  { id: 'chatterbox_500', name: 'Conversation Master', description: 'Send 500 messages', icon: '🎙️', category: 'chat', xp_reward: 150, requirement_type: 'messages_sent', requirement_value: 500 },
  { id: 'chatterbox_1000', name: 'Legendary Speaker', description: 'Send 1000 messages', icon: '🏆', category: 'chat', xp_reward: 300, requirement_type: 'messages_sent', requirement_value: 1000 },
  // Streaks
  { id: 'streak_3', name: 'Getting Started', description: '3-day streak', icon: '🔥', category: 'streak', xp_reward: 15, requirement_type: 'streak_days', requirement_value: 3 },
  { id: 'streak_7', name: 'Week Warrior', description: '7-day streak', icon: '🔥', category: 'streak', xp_reward: 50, requirement_type: 'streak_days', requirement_value: 7 },
  { id: 'streak_30', name: 'Dedicated Learner', description: '30-day streak', icon: '🔥', category: 'streak', xp_reward: 200, requirement_type: 'streak_days', requirement_value: 30 },
  { id: 'streak_100', name: 'Unstoppable', description: '100-day streak', icon: '💎', category: 'streak', xp_reward: 500, requirement_type: 'streak_days', requirement_value: 100 },
  // Learning
  { id: 'vocab_50', name: 'Word Collector', description: 'Save 50 vocabulary words', icon: '📚', category: 'learning', xp_reward: 30, requirement_type: 'vocabulary_count', requirement_value: 50 },
  { id: 'vocab_200', name: 'Walking Dictionary', description: 'Save 200 vocabulary words', icon: '📖', category: 'learning', xp_reward: 100, requirement_type: 'vocabulary_count', requirement_value: 200 },
  { id: 'correction_accept_10', name: 'Quick Learner', description: 'Accept 10 AI corrections', icon: '✅', category: 'learning', xp_reward: 25, requirement_type: 'corrections_received', requirement_value: 10 },
  { id: 'correction_accept_50', name: 'Growth Mindset', description: 'Accept 50 AI corrections', icon: '🧠', category: 'learning', xp_reward: 100, requirement_type: 'corrections_received', requirement_value: 50 },
  // Social
  { id: 'first_follow', name: 'Social Butterfly', description: 'Follow your first user', icon: '🦋', category: 'social', xp_reward: 10, requirement_type: 'following_count', requirement_value: 1 },
  { id: 'popular_10', name: 'Rising Star', description: 'Get 10 followers', icon: '⭐', category: 'social', xp_reward: 50, requirement_type: 'followers_count', requirement_value: 10 },
  { id: 'tandem_first', name: 'Tandem Debut', description: 'Complete your first tandem session', icon: '🤝', category: 'social', xp_reward: 25, requirement_type: 'tandem_sessions_completed', requirement_value: 1 },
  { id: 'tandem_10', name: 'Tandem Pro', description: 'Complete 10 tandem sessions', icon: '🌟', category: 'social', xp_reward: 100, requirement_type: 'tandem_sessions_completed', requirement_value: 10 },
  // Languages
  { id: 'polyglot_2', name: 'Bilingual', description: 'Learn 2 languages', icon: '🌍', category: 'learning', xp_reward: 50, requirement_type: 'languages_count', requirement_value: 2 },
  { id: 'polyglot_3', name: 'Polyglot', description: 'Learn 3 languages', icon: '🌏', category: 'learning', xp_reward: 150, requirement_type: 'languages_count', requirement_value: 3 },
  // Special
  { id: 'event_first', name: 'Community Member', description: 'Attend your first event', icon: '🎉', category: 'special', xp_reward: 20, requirement_type: 'events_attended', requirement_value: 1 },
  { id: 'early_adopter', name: 'Early Adopter', description: 'Joined during beta', icon: '🚀', category: 'special', xp_reward: 100, requirement_type: 'manual', requirement_value: 0, is_hidden: 1 },
];

export async function seedAchievements(db) {
  for (const a of DEFAULT_ACHIEVEMENTS) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO achievements (id, name, description, icon, category, xp_reward, requirement_type, requirement_value, is_hidden)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [a.id, a.name, a.description, a.icon, a.category, a.xp_reward, a.requirement_type, a.requirement_value, a.is_hidden || 0],
    });
  }
}
