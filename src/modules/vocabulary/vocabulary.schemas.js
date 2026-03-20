import { z } from 'zod';

// Vocabulary
export const addVocabularySchema = z.object({
  word: z.string().min(1).max(100).trim(),
  translation: z.string().max(200).optional().default(''),
  language: z.string().min(1).max(10),
  context_sentence: z.string().max(500).optional().default(''),
  source: z.enum(['manual', 'chat', 'ai_correction', 'resource']).optional().default('manual'),
  notes: z.string().max(500).optional().default(''),
});
