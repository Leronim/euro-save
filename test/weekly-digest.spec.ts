import { weeklyDigest } from '../src/expenses/weekly-digest';
import { salaryResult } from '../src/mini-app/salary-calculator';
describe('weekly Telegram digest',()=>{
 it('separates currencies, ranks categories and uses the selected goal',()=>{
  const text=weeklyDigest('21–27 сентября',[
   {amount:20,currency:'EUR',category:{name:'Кофе'}},
   {amount:100,currency:'EUR',category:{name:'Продукты'}},
   {amount:5,currency:'USD'},
  ],[{currency:'EUR',nextPayday:'27.09.2026',result:salaryResult(3000,900,300,30,10,2)}],2);
  expect(text).toContain('Всего: 120.00 EUR');expect(text).toContain('Всего: 5.00 USD');
  expect(text.indexOf('Продукты')).toBeLessThan(text.indexOf('Кофе'));
  expect(text).toContain('Отложить 1000.00 EUR → ещё 800.00 EUR, до 38.09 EUR в день.');
  expect(text).not.toContain('Отложить 500');expect(text).toContain('Ждут подтверждения: 2');
 });
 it('handles missing salary settings and empty weeks',()=>{
  const text=weeklyDigest('Неделя',[],[]);expect(text).toContain('расходов за неделю нет');expect(text).toContain('заполни калькулятор');
 });
 it('shows a shortfall without suggesting a negative daily limit',()=>{
  const text=weeklyDigest('Неделя',[],[{currency:'EUR',nextPayday:'27.09.2026',result:salaryResult(1500,900,300,30,10,2,500)}]);
  expect(text).toContain('не хватает 200.00 EUR');
 });
});
it('uses a custom saved target rather than the fixed scenario presets',()=>{
 const result=salaryResult(3000,900,300,30,10,2,750);
 const text=weeklyDigest('Неделя',[],[{currency:'EUR',nextPayday:'27.09.2026',result}]);
 expect(text).toContain('Отложить 750.00 EUR → ещё 1050.00 EUR, до 50.00 EUR в день.');
 expect(text).not.toContain('Отложить 1000');
});
