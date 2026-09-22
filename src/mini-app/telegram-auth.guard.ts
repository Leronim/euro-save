import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

export function validateTelegramData(raw: string, token: string, owner: string, now = Date.now()) {
  if (typeof raw !== 'string' || !raw || raw.length > 16384 || !token || !owner) throw new UnauthorizedException();
  const params = new URLSearchParams(raw);
  if (new Set(params.keys()).size !== [...params.keys()].length) throw new UnauthorizedException();
  const hash = params.get('hash') ?? '';
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new UnauthorizedException();
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new UnauthorizedException();
  const timestamp = Number(params.get('auth_date'));
  if (!Number.isInteger(timestamp) || timestamp > now / 1000 + 30 || now / 1000 - timestamp > 86400) throw new UnauthorizedException();
  try {
    const user = JSON.parse(params.get('user') ?? '{}');
    if (!Number.isSafeInteger(user.id) || String(user.id) !== owner) throw new Error();
    return String(user.id);
  } catch { throw new UnauthorizedException(); }
}

@Injectable()
export class TelegramAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    request.telegramId = validateTelegramData(request.headers['x-telegram-init-data'],
      this.config.get<string>('TELEGRAM_BOT_TOKEN', ''), this.config.get<string>('TELEGRAM_OWNER_ID', ''));
    return true;
  }
}
