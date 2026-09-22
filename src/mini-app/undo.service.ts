import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const tables = ['expense', 'pendingExpense', 'merchantRule', 'monthlyBudget'] as const;
type Table = typeof tables[number];
type Row = Record<string, unknown> & { id: string };
type Change = { table: Table; id: string; before: Row | null; after: Row | null };
type Store = {
  findMany(args: object): Promise<Row[]>;
  findFirst(args: object): Promise<Row | null>;
  deleteMany(args: object): Promise<unknown>;
  upsert(args: object): Promise<unknown>;
};
const store = (tx: Prisma.TransactionClient, table: Table) => tx[table] as unknown as Store;
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function changedRows(before: Record<Table, Row[]>, after: Record<Table, Row[]>): Change[] {
  return tables.flatMap(table => {
    const old = new Map(before[table].map(row => [row.id, row]));
    const next = new Map(after[table].map(row => [row.id, row]));
    return [...new Set([...old.keys(), ...next.keys()])].flatMap(id => {
      const a = old.get(id) ?? null, b = next.get(id) ?? null;
      return canonical(a) === canonical(b) ? [] : [{ table, id, before: a, after: b }];
    });
  });
}

@Injectable()
export class UndoService {
  constructor(private readonly prisma: PrismaService) {}
  private async snapshot(tx: Prisma.TransactionClient, userId: string) {
    const entries = await Promise.all(tables.map(async table => [table, json(await store(tx, table).findMany({ where: { userId } }))]));
    return Object.fromEntries(entries) as Record<Table, Row[]>;
  }
  async run<T extends object>(userId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      const before = await this.snapshot(tx, userId);
      const result = await operation(tx);
      const changes = changedRows(before, await this.snapshot(tx, userId));
      await tx.undoAction.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
      const action = changes.length ? await tx.undoAction.create({ data: {
        userId, changes: changes as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 10 * 60_000),
      } }) : null;
      return { ...result, undoId: action?.id ?? null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
  }
  async undo(userId: string, id: string) {
    return this.prisma.$transaction(async tx => {
      const action = await tx.undoAction.findFirst({ where: { id, userId, undoneAt: null, expiresAt: { gt: new Date() } } });
      if (!action) throw new NotFoundException('Время отмены истекло или действие уже отменено');
      const changes = action.changes as unknown as Change[];
      for (const change of changes) {
        if (!tables.includes(change.table)) throw new ConflictException('Невозможно отменить действие');
        const current = json(await store(tx, change.table).findFirst({ where: { id: change.id, userId } }));
        if (canonical(current) !== canonical(change.after)) throw new ConflictException('Данные уже изменились. Отмена не затронула новые изменения.');
      }
      for (const change of changes) {
        if (change.before) await store(tx, change.table).upsert({ where: { id: change.id }, create: change.before, update: change.before });
        else await store(tx, change.table).deleteMany({ where: { id: change.id, userId } });
      }
      await tx.undoAction.update({ where: { id }, data: { undoneAt: new Date() } });
      return { ok: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
  }
}
