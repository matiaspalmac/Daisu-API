import { seedRooms } from './rooms.js';
import { seedAchievements } from './achievements.js';
import { seedMemberships } from './memberships.js';
import { seedBannedWords } from './banned-words.js';
import { migrateUserLanguages } from './user-languages.js';

export async function runSeeds(db) {
  await seedRooms(db);
  await seedBannedWords(db);
  await seedMemberships(db);
  await seedAchievements(db);
  await migrateUserLanguages(db);
}
