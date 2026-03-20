import { z } from 'zod';

// Resources
export const createResourceSchema = z.object({
  title: z.string().min(1).max(300).trim(),
  description: z.string().max(2000).optional().default(''),
  url: z.string().max(500).optional().default(''),
  type: z.enum(['textbook', 'video', 'article', 'link', 'tool']),
  language: z.string().max(10).optional().default(''),
  level: z.string().max(10).optional().default(''),
  thumbnail_url: z.string().max(500).optional().default(''),
  author: z.string().max(100).optional().default(''),
  is_featured: z.union([z.boolean(), z.number()]).transform(v => v ? 1 : 0).optional().default(0),
  is_premium: z.union([z.boolean(), z.number()]).transform(v => v ? 1 : 0).optional().default(0),
});
