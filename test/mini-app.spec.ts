import { createHmac } from 'node:crypto';
import { validateTelegramData } from '../src/mini-app/telegram-auth.guard';
import { ExpenseInput, MiniAppController } from '../src/mini-app/mini-app.controller';
import { validate } from 'class-validator';

const now = Date.parse('2026-09-22T10:00:00Z');
function signed(id = 123, authDate = now / 1000) {
  const values = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify({ id, first_name: 'Test' }), query_id: 'query' });
  const check = [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256','WebAppData').update('test-token').digest();
  values.set('hash',createHmac('sha256',secret).update(check).digest('hex'));
  return values.toString();
}
describe('Mini App authentication', () => {
  it('accepts signed owner data', () => expect(validateTelegramData(signed(),'test-token','123',now)).toBe('123'));
  it.each(['', signed(456), signed(123,now/1000-86401), signed(123,now/1000+60), signed().replace('Test','Attacker'), signed()+'&user=%7B%22id%22%3A123%7D'])('rejects invalid, wrong-owner, stale and duplicate data', raw => {
    expect(()=>validateTelegramData(raw,'test-token','123',now)).toThrow();
  });
  it('rejects the wrong bot token',()=>expect(()=>validateTelegramData(signed(),'another-token','123',now)).toThrow());
});
describe('Mini App writes', () => {
  const input = Object.assign(new ExpenseInput(), { merchant:'LIDL', amount:12.5, currency:'EUR', categoryId:'a0b5d4b7-c40b-4b31-86c2-52d0e6356300', transactionDate:'2026-09-22T10:00:00Z' });
  const setup = () => {
    const expenses = {getExpense:jest.fn().mockResolvedValue({id:'expense'}),getPeriodReport:jest.fn().mockResolvedValue({})};
    const prisma = {user:{findUnique:jest.fn().mockResolvedValue({id:'owner'})},category:{findFirst:jest.fn().mockResolvedValue({id:input.categoryId})},expense:{create:jest.fn(),update:jest.fn()}};
    return {expenses,prisma,controller:new MiniAppController(expenses as any,prisma as any)};
  };
  it('validates amounts, dates, currency and category identifiers',async()=>{
    expect(await validate(input)).toHaveLength(0);
    for(const values of [{amount:-1},{amount:1.123},{merchant:''},{currency:'<>'},{categoryId:'foreign'},{transactionDate:'2026-02-31'}]) {
      expect((await validate(Object.assign(new ExpenseInput(),input,values))).length).toBeGreaterThan(0);
    }
  });
  it('scopes creates and category ownership to the signed-in user',async()=>{
    const {controller,prisma}=setup();await controller.create({telegramId:'123'},input);
    expect(prisma.expense.create).toHaveBeenCalledWith({data:expect.objectContaining({userId:'owner',source:'manual'})});
    expect(prisma.category.findFirst).toHaveBeenCalledWith({where:expect.objectContaining({OR:[{userId:null},{userId:'owner'}]})});
  });
  it('does not update someone else’s expense',async()=>{
    const {controller,prisma,expenses}=setup();expenses.getExpense.mockRejectedValue(new Error('not found'));
    await expect(controller.update({telegramId:'123'},'foreign',input)).rejects.toThrow();
    expect(expenses.getExpense).toHaveBeenCalledWith('foreign','owner');expect(prisma.expense.update).not.toHaveBeenCalled();
  });
  it('rejects inaccessible categories and dates without timezone',async()=>{
    const {controller,prisma}=setup();prisma.category.findFirst.mockResolvedValue(null as any);
    await expect(controller.create({telegramId:'123'},input)).rejects.toThrow();
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });
});
