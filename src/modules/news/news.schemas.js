import { z } from 'zod';

// News
export const createNewsSchema = z.object({
  title: z.string().min(1).max(300).trim(),
  content: z.string().min(1).max(50000),
  excerpt: z.string().max(500).optional().default(''),
  category: z.enum(['tips', 'events', 'stories', 'updates', 'world']),
  cover_image_url: z.string().max(500).optional().default(''),
  language: z.string().max(10).optional().default(''),
});
