import { z } from 'zod';

// Events
export const createEventSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(2000).optional().default(''),
  type: z.enum(['session', 'workshop', 'challenge', 'meetup', 'ama']).optional().default('session'),
  language: z.string().max(10).optional().default(''),
  level: z.string().max(10).optional().default(''),
  starts_at: z.string().min(1),
  ends_at: z.string().optional(),
  max_attendees: z.number().int().min(0).optional().default(0),
  is_premium: z.union([z.boolean(), z.number()]).transform(v => v ? 1 : 0).optional().default(0),
});
