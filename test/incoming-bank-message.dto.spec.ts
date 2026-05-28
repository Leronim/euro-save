import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IncomingBankMessageDto } from '../src/incoming/dto/incoming-bank-message.dto';

describe('IncomingBankMessageDto', () => {
  async function validateDto(payload: Record<string, unknown>) {
    return validate(plainToInstance(IncomingBankMessageDto, payload));
  }

  it('accepts valid iOS shortcuts payload', async () => {
    await expect(
      validateDto({
        source: 'ios_shortcuts',
        secret: 'secret',
        sender: 'Eurobank',
        text: 'Purchase 12.40 EUR at LIDL',
        receivedAt: '2026-05-27T21:30:00+03:00',
      }),
    ).resolves.toHaveLength(0);
  });

  it('rejects invalid source, empty text and invalid receivedAt', async () => {
    const errors = await validateDto({
      source: 'telegram',
      secret: '',
      text: '',
      receivedAt: 'not-a-date',
    });

    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['source', 'secret', 'text', 'receivedAt']));
  });
});
