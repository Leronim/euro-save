import { salaryCycle, salaryResult } from '../src/mini-app/salary-calculator';
import { SalaryInput, BackgroundExpenseInput } from '../src/mini-app/mini-app.controller';
import { validate } from 'class-validator';

describe('salary cycle', () => {
  it('uses the previous month before payday and switches at local midnight', () => {
    const before=salaryCycle(27,'Europe/Nicosia',new Date('2026-09-26T20:59:59Z'));
    expect(before.label).toBe('27.08.2026 – 26.09.2026');
    const after=salaryCycle(27,'Europe/Nicosia',new Date('2026-09-26T21:00:00Z'));
    expect(after.label).toBe('27.09.2026 – 26.10.2026');expect(after.elapsed).toBe(1);
  });
  it('clamps day 31 in February without drifting subsequent payments', () => {
    const r=salaryCycle(31,'Europe/Nicosia',new Date('2026-03-01T10:00:00Z'));
    expect(r.label).toBe('28.02.2026 – 30.03.2026');expect(r.nextPayday).toBe('31.03.2026');expect(r.days).toBe(31);
  });
  it('handles leap years, new year and DST as calendar days', () => {
    expect(salaryCycle(31,'Europe/Nicosia',new Date('2028-02-29T10:00:00Z')).label).toBe('29.02.2028 – 30.03.2028');
    expect(salaryCycle(27,'Europe/Nicosia',new Date('2026-01-05T10:00:00Z')).label).toBe('27.12.2025 – 26.01.2026');
    expect(salaryCycle(27,'Europe/Nicosia',new Date('2026-03-31T10:00:00Z')).elapsed).toBe(5);
  });
});
describe('salary calculation', () => {
  it('subtracts background once and forecasts only app spending', () => {
    expect(salaryResult(3000,1000,300,30,10,5)).toEqual({background:1000,spent:300,remaining:1700,projectedExpenses:900,projectedSavings:1100});
  });
  it('keeps deficits visible, uses cents and avoids premature forecasts', () => {
    expect(salaryResult(100,90,20,30,10,1).projectedSavings).toBe(-50);
    expect(salaryResult(0.3,0.1,0.2,30,1,1).remaining).toBe(0);
    expect(salaryResult(100,0,10,30,2,1).projectedSavings).toBeNull();
    expect(salaryResult(100,0,0,30,20,0).projectedSavings).toBeNull();
  });
  it('validates settings and nested expenses', async () => {
    const valid={currency:'EUR',salary:3000,payday:27,background:[Object.assign(new BackgroundExpenseInput(),{name:'Rent',amount:900})]};
    expect(await validate(Object.assign(new SalaryInput(),valid))).toHaveLength(0);
    for(const patch of [{payday:0},{payday:32},{payday:27.5},{salary:-1},{salary:1.001},{background:[Object.assign(new BackgroundExpenseInput(),{name:'Rent',amount:-2})]},{background:Array(31).fill(valid.background[0])}])expect((await validate(Object.assign(new SalaryInput(),valid,patch))).length).toBeGreaterThan(0);
  });
});
