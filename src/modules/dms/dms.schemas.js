import { z } from 'zod';

// DMs
export const sendDMSchema = z.object({
  content: z.string().min(1).max(5000).trim(),
});

export const startDMSchema = z.object({
  userId: z.union([z.string(), z.number()]).transform(String),
});
