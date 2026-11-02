import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { ExpenseQueryDto } from './dto/expense-query.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { PayExpenseDto } from './dto/pay-expense.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { paisaToRupees, rupeesToPaisa } from '@core/utils/currency-paisa.util';
import {
  ExpensePaidFrom,
  ExpensePaymentStatus,
  ShiftStatus,
} from '@prisma/client';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

function getBucket(
  category: string,
): 'Rent' | 'Utilities' | 'Salaries' | 'Petty cash' | 'Other' {
  const cat = (category || '').toLowerCase();
  if (cat.includes('rent')) return 'Rent';
  if (
    cat.includes('utilit') ||
    cat.includes('electric') ||
    cat.includes('gas') ||
    cat.includes('water')
  ) {
    return 'Utilities';
  }
  if (
    cat.includes('salar') ||
    cat.includes('payroll') ||
    cat.includes('wage')
  ) {
    return 'Salaries';
  }
  if (
    cat.includes('petty') ||
    cat.includes('tea') ||
    cat.includes('refresh')
  ) {
    return 'Petty cash';
  }
  return 'Other';
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  // ===========================================================================
  // 1. Get Expenses: Summary Cards, Where It Went, Bills to Pay & Table
  // ===========================================================================

  async listExpenses(storeId: string, query: ExpenseQueryDto) {
    const now = new Date();
    let year: number;
    let monthNum: number; // 1-12

    if (query.month && /^\d{4}-\d{2}$/.test(query.month.trim())) {
      const parts = query.month.trim().split('-').map(Number);
      year = parts[0];
      monthNum = parts[1];
    } else {
      year = now.getFullYear();
      monthNum = now.getMonth() + 1;
    }

    const startDate = new Date(year, monthNum - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, monthNum, 0, 23, 59, 59, 999);

    // Previous month date boundaries
    const prevStartDate = new Date(year, monthNum - 2, 1, 0, 0, 0, 0);
    const prevEndDate = new Date(year, monthNum - 1, 0, 23, 59, 59, 999);

    // Table filters
    const tableWhere: any = {
      storeId,
      expenseDate: { gte: startDate, lte: endDate },
    };

    if (query.status && query.status !== 'ALL') {
      tableWhere.paymentStatus = query.status as ExpensePaymentStatus;
    }

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      tableWhere.OR = [
        { title: { contains: s, mode: 'insensitive' as const } },
        { vendorName: { contains: s, mode: 'insensitive' as const } },
        { category: { contains: s, mode: 'insensitive' as const } },
        { referenceNo: { contains: s, mode: 'insensitive' as const } },
      ];
    }

    // Execute in 1 parallel bundle
    const [
      monthExpenses,
      prevMonthExpenses,
      pendingBills,
      tableTotal,
      tableEntries,
    ] = await Promise.all([
      // 1. Current month expenses for metrics
      this.prisma.expense.findMany({
        where: {
          storeId,
          expenseDate: { gte: startDate, lte: endDate },
        },
      }),

      // 2. Previous month expenses for comparison & bucket trends
      this.prisma.expense.findMany({
        where: {
          storeId,
          expenseDate: { gte: prevStartDate, lte: prevEndDate },
        },
        select: {
          amount: true,
          category: true,
        },
      }),

      // 3. Bills to pay (all unpaid/partial across store)
      this.prisma.expense.findMany({
        where: {
          storeId,
          paymentStatus: {
            in: [ExpensePaymentStatus.UNPAID, ExpensePaymentStatus.PARTIAL],
          },
        },
        orderBy: [{ dueDate: 'asc' }, { expenseDate: 'asc' }],
      }),

      // 4. Paginated table count
      this.prisma.expense.count({ where: tableWhere }),

      // 5. Paginated table items
      this.prisma.expense.findMany({
        where: tableWhere,
        orderBy: { expenseDate: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
    ]);

    // -------------------------------------------------------------------------
    // A. Left KPI Summary Card
    // -------------------------------------------------------------------------
    let totalAmountPaisa = 0n;
    let actuallyPaidPaisa = 0n;
    let bankPaidPaisa = 0n;
    let cashDrawerPaidPaisa = 0n;
    let pettyCashPaidPaisa = 0n;

    for (const exp of monthExpenses) {
      totalAmountPaisa += exp.amount;
      actuallyPaidPaisa += exp.paidAmount;

      if (exp.paidFrom === ExpensePaidFrom.BANK) {
        bankPaidPaisa += exp.paidAmount;
      } else if (exp.paidFrom === ExpensePaidFrom.CASH_DRAWER) {
        cashDrawerPaidPaisa += exp.paidAmount;
      } else if (exp.paidFrom === ExpensePaidFrom.PETTY_CASH) {
        pettyCashPaidPaisa += exp.paidAmount;
      }
    }

    const prevMonthAmountPaisa = prevMonthExpenses.reduce(
      (sum, e) => sum + e.amount,
      0n,
    );

    const expensesRecordedPKR = paisaToRupees(totalAmountPaisa);
    const previousMonthPKR = paisaToRupees(prevMonthAmountPaisa);
    const actuallyPaidPKR = paisaToRupees(actuallyPaidPaisa);
    const stillOwedPaisa = totalAmountPaisa - actuallyPaidPaisa;
    const stillOwedPKR = paisaToRupees(stillOwedPaisa > 0n ? stillOwedPaisa : 0n);

    let vsPreviousMonthPct = 0;
    if (previousMonthPKR > 0) {
      vsPreviousMonthPct = Number(
        (
          ((expensesRecordedPKR - previousMonthPKR) / previousMonthPKR) *
          100
        ).toFixed(1),
      );
    } else if (expensesRecordedPKR > 0) {
      vsPreviousMonthPct = 100;
    }

    const summary = {
      expensesRecordedPKR,
      previousMonthPKR,
      vsPreviousMonthPct,
      actuallyPaidPKR,
      stillOwedPKR,
      paidBreakdown: {
        bankPKR: paisaToRupees(bankPaidPaisa),
        cashDrawerPKR: paisaToRupees(cashDrawerPaidPaisa),
        pettyCashPKR: paisaToRupees(pettyCashPaidPaisa),
      },
    };

    // -------------------------------------------------------------------------
    // B. Where It Went (5-Bucket Progress Card)
    // -------------------------------------------------------------------------
    const bucketsOrder: Array<
      'Rent' | 'Utilities' | 'Salaries' | 'Petty cash' | 'Other'
    > = ['Rent', 'Utilities', 'Salaries', 'Petty cash', 'Other'];

    const curBucketMap: Record<string, bigint> = {
      Rent: 0n,
      Utilities: 0n,
      Salaries: 0n,
      'Petty cash': 0n,
      Other: 0n,
    };

    const prevBucketMap: Record<string, bigint> = {
      Rent: 0n,
      Utilities: 0n,
      Salaries: 0n,
      'Petty cash': 0n,
      Other: 0n,
    };

    for (const exp of monthExpenses) {
      const b = getBucket(exp.category);
      curBucketMap[b] += exp.amount;
    }

    for (const exp of prevMonthExpenses) {
      const b = getBucket(exp.category);
      prevBucketMap[b] += exp.amount;
    }

    const whereItWent = bucketsOrder.map((bucket) => {
      const amtPaisa = curBucketMap[bucket];
      const amountPKR = paisaToRupees(amtPaisa);
      const lastMonthPKR = paisaToRupees(prevBucketMap[bucket]);
      const sharePct =
        expensesRecordedPKR > 0
          ? Math.round((amountPKR / expensesRecordedPKR) * 100)
          : 0;

      return {
        bucket,
        amountPKR,
        sharePct,
        lastMonthPKR,
      };
    });

    // -------------------------------------------------------------------------
    // C. Bills to Pay (Pending / Unpaid Bills Sidebar Card)
    // -------------------------------------------------------------------------
    const billsToPay = {
      pendingCount: pendingBills.length,
      items: pendingBills.map((b) => {
        const remainingPaisa = b.amount - b.paidAmount;
        const amountDuePKR = paisaToRupees(
          remainingPaisa > 0n ? remainingPaisa : 0n,
        );
        const dueDateFormatted = b.dueDate
          ? `Due ${formatDate(b.dueDate)}`
          : `Added ${formatDate(b.expenseDate)}`;

        return {
          id: b.id,
          title: b.title,
          vendorName: b.vendorName,
          dueDateFormatted,
          amountDuePKR,
        };
      }),
    };

    // -------------------------------------------------------------------------
    // D. Paginated Entries Table
    // -------------------------------------------------------------------------
    const items = tableEntries.map((e) => {
      const amountPKR = paisaToRupees(e.amount);
      const paidAmountPKR = paisaToRupees(e.paidAmount);
      const remainingDuePaisa = e.amount - e.paidAmount;
      const remainingDuePKR = paisaToRupees(
        remainingDuePaisa > 0n ? remainingDuePaisa : 0n,
      );
      const dateFormatted = formatDate(e.expenseDate);

      let paidFromLabel: 'Cash drawer' | 'Bank' | 'Petty cash' | 'Not paid' =
        'Cash drawer';
      if (e.paidFrom === ExpensePaidFrom.BANK) {
        paidFromLabel = 'Bank';
      } else if (e.paidFrom === ExpensePaidFrom.PETTY_CASH) {
        paidFromLabel = 'Petty cash';
      } else if (e.paidFrom === ExpensePaidFrom.NOT_PAID) {
        paidFromLabel = 'Not paid';
      }

      let statusBadge: 'Paid' | 'Partial' | 'Unpaid' = 'Paid';
      if (e.paymentStatus === ExpensePaymentStatus.PARTIAL) {
        statusBadge = 'Partial';
      } else if (e.paymentStatus === ExpensePaymentStatus.UNPAID) {
        statusBadge = 'Unpaid';
      }

      return {
        id: e.id,
        title: e.title,
        category: e.category,
        vendorName: e.vendorName,
        dateFormatted,
        subtitle: `${dateFormatted} · ${e.category} · ${e.vendorName}`,
        paidFrom: e.paidFrom,
        paidFromLabel,
        paymentStatus: e.paymentStatus,
        statusBadge,
        amountPKR,
        paidAmountPKR,
        remainingDuePKR,
        repeatsMonthly: e.repeatsMonthly,
        canRecordPayment:
          e.paymentStatus === ExpensePaymentStatus.UNPAID ||
          e.paymentStatus === ExpensePaymentStatus.PARTIAL,
      };
    });

    return {
      summary,
      whereItWent,
      billsToPay,
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total: tableTotal,
        totalPages: Math.ceil(tableTotal / query.limit) || 1,
      },
    };
  }

  // ===========================================================================
  // 2. Add New Expense Modal
  // ===========================================================================

  async createExpense(storeId: string, userId: string, dto: CreateExpenseDto) {
    const amountPaisa = rupeesToPaisa(dto.amount);
    let paidAmountPaisa = 0n;

    if (dto.paymentStatus === ExpensePaymentStatus.PAID) {
      paidAmountPaisa =
        dto.paidAmount !== undefined
          ? rupeesToPaisa(dto.paidAmount)
          : amountPaisa;
    } else if (dto.paymentStatus === ExpensePaymentStatus.UNPAID) {
      paidAmountPaisa = 0n;
    } else if (dto.paymentStatus === ExpensePaymentStatus.PARTIAL) {
      if (dto.paidAmount === undefined || dto.paidAmount <= 0) {
        throw new BadRequestException(
          'Paid amount is required and must be greater than 0 for partial expenses',
        );
      }
      paidAmountPaisa = rupeesToPaisa(dto.paidAmount);
      if (paidAmountPaisa >= amountPaisa) {
        throw new BadRequestException(
          'Partial paid amount must be less than the total expense amount',
        );
      }
    }

    let paidFrom = dto.paidFrom || ExpensePaidFrom.CASH_DRAWER;
    if (dto.paymentStatus === ExpensePaymentStatus.UNPAID) {
      paidFrom = ExpensePaidFrom.NOT_PAID;
    }

    return this.prisma.$transaction(async (tx) => {
      // Find open shift if paid from cash drawer
      const openShift = await tx.cashierShift.findFirst({
        where: { storeId, status: ShiftStatus.OPEN },
      });

      if (
        paidAmountPaisa > 0n &&
        paidFrom === ExpensePaidFrom.CASH_DRAWER &&
        openShift
      ) {
        await tx.cashierShift.update({
          where: { id: openShift.id },
          data: {
            expectedCash: { decrement: paidAmountPaisa },
          },
        });
      }

      const expense = await tx.expense.create({
        data: {
          storeId,
          shiftId: dto.shiftId || openShift?.id || null,
          title: dto.title.trim(),
          category: dto.category.trim(),
          vendorName: dto.vendorName.trim(),
          amount: amountPaisa,
          paidAmount: paidAmountPaisa,
          paymentStatus: dto.paymentStatus,
          paidFrom,
          expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : new Date(),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          referenceNo: dto.referenceNo?.trim() || null,
          repeatsMonthly: dto.repeatsMonthly ?? false,
          notes: dto.notes?.trim() || null,
          createdById: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          storeId,
          userId,
          action: 'EXPENSE_CREATED',
          entity: 'Expense',
          entityId: expense.id,
          details: {
            title: expense.title,
            category: expense.category,
            vendorName: expense.vendorName,
            amountPKR: dto.amount,
            paidAmountPKR: paisaToRupees(paidAmountPaisa),
            paymentStatus: expense.paymentStatus,
            paidFrom: expense.paidFrom,
          },
        },
      });

      return {
        id: expense.id,
        title: expense.title,
        category: expense.category,
        vendorName: expense.vendorName,
        amountPKR: paisaToRupees(expense.amount),
        paidAmountPKR: paisaToRupees(expense.paidAmount),
        remainingDuePKR: paisaToRupees(expense.amount - expense.paidAmount),
        paymentStatus: expense.paymentStatus,
        paidFrom: expense.paidFrom,
        expenseDate: expense.expenseDate.toISOString(),
        dueDate: expense.dueDate ? expense.dueDate.toISOString() : null,
        referenceNo: expense.referenceNo,
        repeatsMonthly: expense.repeatsMonthly,
      };
    });
  }

  // ===========================================================================
  // 3. Record Payment on Unpaid / Partial Bill
  // ===========================================================================

  async payExpense(
    storeId: string,
    userId: string,
    id: string,
    dto: PayExpenseDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({
        where: { id, storeId },
      });

      if (!expense) {
        throw new NotFoundException(`Expense with ID "${id}" not found`);
      }

      if (expense.paymentStatus === ExpensePaymentStatus.PAID) {
        throw new BadRequestException('This expense is already fully paid');
      }

      const remainingDuePaisa = expense.amount - expense.paidAmount;
      let paymentPaisa: bigint;

      if (dto.amount !== undefined && dto.amount > 0) {
        const requestedPaisa = rupeesToPaisa(dto.amount);
        paymentPaisa =
          requestedPaisa > remainingDuePaisa ? remainingDuePaisa : requestedPaisa;
      } else {
        paymentPaisa = remainingDuePaisa;
      }

      const newPaidAmount = expense.paidAmount + paymentPaisa;
      const newStatus =
        newPaidAmount >= expense.amount
          ? ExpensePaymentStatus.PAID
          : ExpensePaymentStatus.PARTIAL;

      // If paying via Cash Drawer, decrement active open shift
      const openShift = await tx.cashierShift.findFirst({
        where: { storeId, status: ShiftStatus.OPEN },
      });

      if (dto.paidFrom === ExpensePaidFrom.CASH_DRAWER && openShift) {
        await tx.cashierShift.update({
          where: { id: openShift.id },
          data: {
            expectedCash: { decrement: paymentPaisa },
          },
        });
      }

      const updated = await tx.expense.update({
        where: { id },
        data: {
          paidAmount: newPaidAmount,
          paymentStatus: newStatus,
          paidFrom: dto.paidFrom,
          referenceNo: dto.referenceNo?.trim() || expense.referenceNo,
          shiftId: expense.shiftId || openShift?.id || null,
        },
      });

      await tx.auditLog.create({
        data: {
          storeId,
          userId,
          action: 'EXPENSE_PAID',
          entity: 'Expense',
          entityId: id,
          details: {
            title: updated.title,
            paymentPKR: paisaToRupees(paymentPaisa),
            paidFrom: dto.paidFrom,
            newPaymentStatus: newStatus,
            totalPaidPKR: paisaToRupees(newPaidAmount),
          },
        },
      });

      return {
        id: updated.id,
        title: updated.title,
        category: updated.category,
        vendorName: updated.vendorName,
        amountPKR: paisaToRupees(updated.amount),
        paidAmountPKR: paisaToRupees(updated.paidAmount),
        remainingDuePKR: paisaToRupees(updated.amount - updated.paidAmount),
        paymentStatus: updated.paymentStatus,
        paidFrom: updated.paidFrom,
        expenseDate: updated.expenseDate.toISOString(),
        dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
        referenceNo: updated.referenceNo,
        repeatsMonthly: updated.repeatsMonthly,
      };
    });
  }

  // ===========================================================================
  // 4. Audit Logs (Paginated)
  // ===========================================================================

  async listAuditLogs(storeId: string, query?: PaginationQueryDto) {
    const where = { storeId };
    const limit = query?.limit || 20;
    const skip = query?.skip || 0;

    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      items,
      meta: {
        page: query?.page || 1,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
