import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MINI_APP_URL: z.string().url().default('https://46.225.185.193.sslip.io/mini-app'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_OWNER_ID: z.string().optional().default(''),
  IOS_SHORTCUT_SECRET: z.string().min(1),
  DEFAULT_CURRENCY: z.string().default('EUR'),
  DEFAULT_TIMEZONE: z.string().default('Europe/Nicosia'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>) {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }

  return parsed.data;
}
