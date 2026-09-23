import { formatMoney } from '../common/utils/money';
import { salaryResult } from '../mini-app/salary-calculator';

type ExpenseRow = { amount: unknown; currency: string; category?: { name: string } | null };
type PlanSummary = { currency: string; nextPayday: string; result: ReturnType<typeof salaryResult> };
export function weeklyDigest(label: string, rows: ExpenseRow[], plans: PlanSummary[], pending = 0) {
  const lines = ['📊 Расходы за неделю', label, 'По воскресенье, 20:00 · время Кипра', ''];
  const currencies = [...new Set(rows.map(row => row.currency))].sort();
  if (!rows.length) lines.push('Подтверждённых расходов за неделю нет.');
  for (const currency of currencies.slice(0, 5)) {
    const items = rows.filter(row => row.currency === currency);
    const total = items.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
    lines.push(`Всего: ${formatMoney(total / 100, currency)} · ${items.length} оп.`);
    const categories = new Map<string, number>();
    for (const row of items) { const name = row.category?.name ?? 'Без категории'; categories.set(name, (categories.get(name) ?? 0) + Math.round(Number(row.amount) * 100)); }
    for (const [name, amount] of [...categories].sort((a,b) => b[1]-a[1]).slice(0,3)) lines.push(`• ${name.replace(/\s+/g,' ').slice(0,60)}: ${formatMoney(amount/100,currency)}`);
    lines.push('');
  }
  for (const plan of plans.slice(0, 5)) {
    lines.push(`💰 До зарплаты ${plan.nextPayday} · ${plan.currency}`);
    const targets = [plan.result.selectedTarget];
    for (const target of targets) {
      lines.push(target.achievable
        ? `Отложить ${formatMoney(target.target,plan.currency)} → ещё ${formatMoney(target.remainingBudget,plan.currency)}, до ${formatMoney(target.dailyLimit,plan.currency)} в день.`
        : `Отложить ${formatMoney(target.target,plan.currency)}: не хватает ${formatMoney(target.shortfall,plan.currency)} даже без новых покупок.`);
    }
    lines.push(`Лимит на ${plan.result.remainingDays} дн., включая остаток сегодня. Фоновые расходы и покупки уже вычтены.`, '');
  }
  if (!plans.length) lines.push('Чтобы видеть лимит до зарплаты, заполни калькулятор во вкладке «Накопления».');
  if (pending) lines.push(`Ждут подтверждения: ${pending}. В суммы пока не включены.`);
  lines.push('Покупки после 20:00 появятся в приложении; в этот отчёт они не входят.');
  return lines.join('\n');
}
