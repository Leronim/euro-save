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
    expect(salaryResult(3000,1000,300,30,10,5)).toMatchObject({background:1000,spent:300,remaining:1700,projectedExpenses:900,projectedSavings:1100});
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

describe('savings targets', () => {
  it('deducts background and purchases before allocating remaining days including today', () => {
    const result=salaryResult(3000,900,300,30,10,5);
    expect(result.remainingDays).toBe(21);
    expect(result.targets).toEqual([
      {target:500,periodBudget:1600,remainingBudget:1300,dailyLimit:61.90,shortfall:0,achievable:true},
      {target:1000,periodBudget:1100,remainingBudget:800,dailyLimit:38.09,shortfall:0,achievable:true},
      {target:1500,periodBudget:600,remainingBudget:300,dailyLimit:14.28,shortfall:0,achievable:true},
    ]);
  });
  it('shows deficits instead of negative spending limits', () => {
    const result=salaryResult(2000,900,200,30,30,1);
    expect(result.remainingDays).toBe(1);
    expect(result.targets[0].dailyLimit).toBe(400);
    expect(result.targets[1]).toMatchObject({achievable:false,shortfall:100,dailyLimit:0,remainingBudget:0});
    expect(result.targets[2]).toMatchObject({achievable:false,shortfall:600});
  });
  it('supports an exact target and does not round the daily limit upwards', () => {
    expect(salaryResult(1500,500,500,31,1,1).targets[0]).toMatchObject({achievable:true,remainingBudget:0,dailyLimit:0});
    const r=salaryResult(501,0,0,3,1,0);
    expect(r.targets[0].dailyLimit).toBe(0.33);
    expect(r.targets[0].dailyLimit*r.remainingDays).toBeLessThanOrEqual(r.targets[0].remainingBudget);
  });
});
