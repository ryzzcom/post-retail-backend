import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { CashMovementDto } from './dto/cash-movement.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { paisaToRupees, rupeesToPaisa } from '@core/utils/currency-paisa.util';
import { formatPktDateTime, formatPktTime } from '@core/utils/date-time.util';
import {
  ShiftStatus,
  PaymentMethod,
  ExpensePaidFrom,
  CashDrawerAdjustmentType,
  KhataTransactionType,
  OrderStatus,
  Prisma,
} from '@prisma/client';

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 1. POST /api/v1/shifts/open
   * Open shift on a counter with starting cash float
   */
  async openShift(storeId: string, cashierId: string, dto: OpenShiftDto) {
    // Check if cashier already has an active open shift
    const existing = await this.prisma.cashierShift.findFirst({
      where: {
        storeId,
        cashierId,
        status: ShiftStatus.OPEN,
      },
    });

    if (existing) {
      throw new BadRequestException('Cashier already has an active open shift in progress');
    }

    // Resolve Counter
    let counterId = dto.counterId;
    const counter = await this.prisma.counter.findFirst({
      where: {
        storeId,
        OR: [{ id: counterId }, { code: counterId }],
      },
    });

    if (counter) {
      counterId = counter.id;
    } else {
      const firstCounter = await this.prisma.counter.findFirst({ where: { storeId } });
      if (firstCounter) {
        counterId = firstCounter.id;
      } else {
        const newCounter = await this.prisma.counter.create({
          data: {
            storeId,
            code: '1',
            name: 'Counter 1',
            isActive: true,
          },
        });
        counterId = newCounter.id;
      }
    }

    const openingFloatPaisa = rupeesToPaisa(dto.openingFloat);

    const shift = await this.prisma.cashierShift.create({
      data: {
        storeId,
        counterId,
        cashierId,
        openingFloat: openingFloatPaisa,
        expectedCash: openingFloatPaisa,
        status: ShiftStatus.OPEN,
        notes: dto.notes,
      },
      include: {
        counter: true,
        cashier: {
          select: { id: true, firstName: true, lastName: true, fullName: true, email: true },
        },
      },
    });

    const cashierName =
      shift.cashier.fullName ||
      `${shift.cashier.firstName ?? ''} ${shift.cashier.lastName ?? ''}`.trim() ||
      'Cashier';

    return {
      ...shift,
      status: 'open',
      openedAt: formatPktDateTime(shift.openedAt),
      openedBy: cashierName,
      counterName: shift.counter.name,
      startingFloatPKR: paisaToRupees(shift.openingFloat),
      openingFloatPKR: paisaToRupees(shift.openingFloat),
      expectedCashInDrawerPKR: paisaToRupees(shift.expectedCash),
      expectedCashPKR: paisaToRupees(shift.expectedCash),
      netSalesPKR: 0,
      receiptsCount: 0,
      cashCollectedPKR: 0,
      cardDigitalCollectedPKR: 0,
      cashInTotalPKR: 0,
      cashOutTotalPKR: 0,
    };
  }

  /**
   * 2. GET /api/v1/shifts/current
   * Active shift dashboard with drawer reconciliation formula & live transactions
   */
  async getCurrentShift(storeId: string, cashierId: string, counterId?: string) {
    const where: Prisma.CashierShiftWhereInput = {
      storeId,
      status: ShiftStatus.OPEN,
    };

    if (counterId) {
      const counter = await this.prisma.counter.findFirst({
        where: {
          storeId,
          OR: [{ id: counterId }, { code: counterId }],
        },
      });
      if (counter) {
        where.counterId = counter.id;
      }
    } else {
      where.cashierId = cashierId;
    }

    let shift = await this.prisma.cashierShift.findFirst({
      where,
      orderBy: { openedAt: 'desc' },
      include: {
        counter: true,
        cashier: {
          select: { id: true, firstName: true, lastName: true, fullName: true, email: true },
        },
      },
    });

    // Fallback: If no shift found by cashierId, look for any open shift in store
    if (!shift) {
      shift = await this.prisma.cashierShift.findFirst({
        where: { storeId, status: ShiftStatus.OPEN },
        orderBy: { openedAt: 'desc' },
        include: {
          counter: true,
          cashier: {
            select: { id: true, firstName: true, lastName: true, fullName: true, email: true },
          },
        },
      });
    }

    if (!shift) {
      return null;
    }

    // Tally shift orders, payments, expenses, khata collections, and movements
    const [orders, cashExpenses, khataCollections, cashMovements] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          storeId,
          shiftId: shift.id,
          status: OrderStatus.COMPLETED,
        },
        include: {
          customer: { select: { name: true, phone: true } },
          payments: true,
          items: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.expense.aggregate({
        where: {
          storeId,
          shiftId: shift.id,
          paidFrom: ExpensePaidFrom.CASH_DRAWER,
        },
        _sum: { paidAmount: true },
      }),
      this.prisma.khataLedger.aggregate({
        where: {
          storeId,
          type: KhataTransactionType.CREDIT_PAYMENT,
          createdAt: { gte: shift.openedAt },
        },
        _sum: { amount: true },
      }),
      this.prisma.shiftCashMovement.findMany({
        where: {
          storeId,
          shiftId: shift.id,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Financial breakdown
    let netSalesPaisa = 0n;
    let cashSalesPaisa = 0n;
    let cardDigitalSalesPaisa = 0n;
    let khataSalesPaisa = 0n;

    for (const order of orders) {
      netSalesPaisa += order.grandTotal;
      for (const p of order.payments) {
        if (p.method === PaymentMethod.CASH) {
          cashSalesPaisa += p.amount;
        } else if (
          p.method === PaymentMethod.CARD ||
          p.method === PaymentMethod.BANK_TRANSFER ||
          p.method === PaymentMethod.WALLET
        ) {
          cardDigitalSalesPaisa += p.amount;
        } else if (p.method === PaymentMethod.KHATA) {
          khataSalesPaisa += p.amount;
        }
      }
    }

    const khataCollectionsPaisa = khataCollections._sum.amount || 0n;
    const cashPaidOut = cashExpenses._sum.paidAmount || 0n;

    const totalCashIn = cashMovements
      .filter((m) => m.type === CashDrawerAdjustmentType.CASH_IN)
      .reduce((sum, m) => sum + m.amount, 0n);
    const totalCashOut = cashMovements
      .filter((m) => m.type === CashDrawerAdjustmentType.CASH_OUT)
      .reduce((sum, m) => sum + m.amount, 0n);

    // Accurate Drawer Reconciliation Formula:
    // Expected Cash = Opening Float + Cash Sales + Khata Cash Collections + Cash In - Cash Expenses - Cash Out
    const currentExpectedCash =
      shift.openingFloat + cashSalesPaisa + khataCollectionsPaisa + totalCashIn - cashPaidOut - totalCashOut;

    const cashierName =
      shift.cashier.fullName ||
      `${shift.cashier.firstName ?? ''} ${shift.cashier.lastName ?? ''}`.trim() ||
      'Cashier';

    const transactions = orders.map((o) => {
      const itemsCount = o.items.reduce((acc, i) => acc + i.quantity, 0);
      const paymentSummary = o.payments.map((p) => p.method).join(', ') || 'Cash';
      return {
        id: o.receiptNo,
        time: formatPktTime(o.createdAt),
        customerName: o.customer?.name || 'Walk-in',
        amountPKR: paisaToRupees(o.grandTotal),
        paymentMethod: paymentSummary,
        itemsCount,
      };
    });

    return {
      ...shift,
      status: 'open',
      openedAt: formatPktDateTime(shift.openedAt),
      openedBy: cashierName,
      counterName: shift.counter.name,
      startingFloatPKR: paisaToRupees(shift.openingFloat),
      openingFloatPKR: paisaToRupees(shift.openingFloat),
      netSalesPKR: paisaToRupees(netSalesPaisa),
      receiptsCount: orders.length,
      cashCollectedPKR: paisaToRupees(cashSalesPaisa),
      cardDigitalCollectedPKR: paisaToRupees(cardDigitalSalesPaisa),
      khataSalesPKR: paisaToRupees(khataSalesPaisa),
      khataCollectionsPKR: paisaToRupees(khataCollectionsPaisa),
      cashInTotalPKR: paisaToRupees(totalCashIn),
      cashOutTotalPKR: paisaToRupees(totalCashOut),
      cashPaidOutPKR: paisaToRupees(cashPaidOut),
      expectedCashInDrawerPKR: paisaToRupees(currentExpectedCash),
      expectedCashPKR: paisaToRupees(currentExpectedCash),
      movements: cashMovements.map((m) => ({
        id: m.id,
        type: m.type === CashDrawerAdjustmentType.CASH_IN ? 'cash_in' : 'cash_out',
        amountPKR: paisaToRupees(m.amount),
        reason: m.reason,
        notes: m.notes,
        createdAt: m.createdAt.toISOString(),
      })),
      transactions,
    };
  }

  /**
   * 3. POST /api/v1/shifts/cash-movement
   * Cash In / Cash Out drawer adjustment
   */
  async recordCashMovement(
    storeId: string,
    cashierId: string,
    dto: CashMovementDto,
  ) {
    const shift = await this.prisma.cashierShift.findFirst({
      where: {
        storeId,
        cashierId,
        status: ShiftStatus.OPEN,
      },
    });

    if (!shift) {
      throw new NotFoundException('No active open shift found for this counter / cashier');
    }

    const amountPaisa = rupeesToPaisa(dto.amount);

    const movement = await this.prisma.shiftCashMovement.create({
      data: {
        storeId,
        shiftId: shift.id,
        type: dto.type,
        amount: amountPaisa,
        reason: dto.reason.trim(),
        notes: dto.notes?.trim() || null,
        performedByUserId: cashierId,
      },
    });

    // Update expectedCash on shift atomically
    const newExpectedCash =
      dto.type === CashDrawerAdjustmentType.CASH_IN
        ? shift.expectedCash + amountPaisa
        : shift.expectedCash - amountPaisa;

    await this.prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        expectedCash: newExpectedCash,
      },
    });

    return {
      id: movement.id,
      shiftId: shift.id,
      type: movement.type === CashDrawerAdjustmentType.CASH_IN ? 'cash_in' : 'cash_out',
      amountPKR: paisaToRupees(movement.amount),
      reason: movement.reason,
      notes: movement.notes,
      newExpectedCashPKR: paisaToRupees(newExpectedCash),
      createdAt: movement.createdAt.toISOString(),
    };
  }

  /**
   * 4. POST /api/v1/shifts/:id/close or POST /api/v1/shifts/close
   * Close active shift with actual drawer count, over/short diff & Z-Report
   */
  async closeShift(
    storeId: string,
    shiftId: string | undefined,
    cashierId: string,
    dto: CloseShiftDto,
  ) {
    let targetShiftId = shiftId;

    if (!targetShiftId || targetShiftId === 'close' || targetShiftId === 'current') {
      const activeShift = await this.prisma.cashierShift.findFirst({
        where: { storeId, cashierId, status: ShiftStatus.OPEN },
        orderBy: { openedAt: 'desc' },
      });
      if (!activeShift) {
        throw new NotFoundException('No open shift found to close');
      }
      targetShiftId = activeShift.id;
    }

    const shift = await this.prisma.cashierShift.findFirst({
      where: { id: targetShiftId, storeId, status: ShiftStatus.OPEN },
      include: {
        counter: true,
        cashier: {
          select: { id: true, firstName: true, lastName: true, fullName: true, email: true },
        },
      },
    });

    if (!shift) {
      throw new NotFoundException(`Open shift ${targetShiftId} not found`);
    }

    // Tally all financial totals
    const [orders, cashExpenses, khataCollections, cashMovements] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          storeId,
          shiftId: shift.id,
          status: OrderStatus.COMPLETED,
        },
        include: { payments: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          storeId,
          shiftId: shift.id,
          paidFrom: ExpensePaidFrom.CASH_DRAWER,
        },
        _sum: { paidAmount: true },
      }),
      this.prisma.khataLedger.aggregate({
        where: {
          storeId,
          type: KhataTransactionType.CREDIT_PAYMENT,
          createdAt: { gte: shift.openedAt },
        },
        _sum: { amount: true },
      }),
      this.prisma.shiftCashMovement.findMany({
        where: {
          storeId,
          shiftId: shift.id,
        },
      }),
    ]);

    let netSalesPaisa = 0n;
    let cashSalesPaisa = 0n;
    let cardDigitalSalesPaisa = 0n;
    let khataSalesPaisa = 0n;

    for (const order of orders) {
      netSalesPaisa += order.grandTotal;
      for (const p of order.payments) {
        if (p.method === PaymentMethod.CASH) {
          cashSalesPaisa += p.amount;
        } else if (
          p.method === PaymentMethod.CARD ||
          p.method === PaymentMethod.BANK_TRANSFER ||
          p.method === PaymentMethod.WALLET
        ) {
          cardDigitalSalesPaisa += p.amount;
        } else if (p.method === PaymentMethod.KHATA) {
          khataSalesPaisa += p.amount;
        }
      }
    }

    const khataCollectionsPaisa = khataCollections._sum.amount || 0n;
    const cashPaidOut = cashExpenses._sum.paidAmount || 0n;
    const totalCashIn = cashMovements
      .filter((m) => m.type === CashDrawerAdjustmentType.CASH_IN)
      .reduce((sum, m) => sum + m.amount, 0n);
    const totalCashOut = cashMovements
      .filter((m) => m.type === CashDrawerAdjustmentType.CASH_OUT)
      .reduce((sum, m) => sum + m.amount, 0n);

    const expectedCash =
      shift.openingFloat + cashSalesPaisa + khataCollectionsPaisa + totalCashIn - cashPaidOut - totalCashOut;
    const actualCashPaisa = rupeesToPaisa(dto.actualCash);
    const overShortDiff = actualCashPaisa - expectedCash;

    const closedAt = new Date();

    const updated = await this.prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        expectedCash,
        actualCash: actualCashPaisa,
        overShortDiff,
        status: ShiftStatus.CLOSED,
        closedAt,
        notes: dto.notes,
      },
    });

    const cashierName =
      shift.cashier.fullName ||
      `${shift.cashier.firstName ?? ''} ${shift.cashier.lastName ?? ''}`.trim() ||
      'Cashier';

    return {
      ...updated,
      status: 'closed',
      openedAt: formatPktDateTime(shift.openedAt),
      closedAt: formatPktDateTime(closedAt),
      openedBy: cashierName,
      counterName: shift.counter.name,
      startingFloatPKR: paisaToRupees(updated.openingFloat),
      openingFloatPKR: paisaToRupees(updated.openingFloat),
      netSalesPKR: paisaToRupees(netSalesPaisa),
      receiptsCount: orders.length,
      cashCollectedPKR: paisaToRupees(cashSalesPaisa),
      cardDigitalCollectedPKR: paisaToRupees(cardDigitalSalesPaisa),
      khataSalesPKR: paisaToRupees(khataSalesPaisa),
      khataCollectionsPKR: paisaToRupees(khataCollectionsPaisa),
      cashInTotalPKR: paisaToRupees(totalCashIn),
      cashOutTotalPKR: paisaToRupees(totalCashOut),
      expectedCashInDrawerPKR: paisaToRupees(updated.expectedCash),
      expectedCashPKR: paisaToRupees(updated.expectedCash),
      actualCashPKR: paisaToRupees(updated.actualCash || 0n),
      overShortDiffPKR: paisaToRupees(updated.overShortDiff || 0n),
    };
  }

  /**
   * 5. GET /api/v1/shifts
   * List shift history
   */
  async listShifts(storeId: string, query?: PaginationQueryDto) {
    const where = {
      storeId,
    };

    const limit = query?.limit || 20;
    const skip = query?.skip || 0;

    const [total, items] = await Promise.all([
      this.prisma.cashierShift.count({ where }),
      this.prisma.cashierShift.findMany({
        where,
        include: {
          cashier: {
            select: { id: true, firstName: true, lastName: true, email: true, fullName: true },
          },
          counter: true,
          cashMovements: {
            select: { id: true, type: true, amount: true, reason: true, createdAt: true },
          },
        },
        orderBy: { openedAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: items.map((s) => ({
        ...s,
        status: s.status === ShiftStatus.OPEN ? 'open' : 'closed',
        openedAt: formatPktDateTime(s.openedAt),
        closedAt: s.closedAt ? formatPktDateTime(s.closedAt) : null,
        openedBy: s.cashier?.fullName || s.cashier?.firstName || 'Cashier',
        counterName: s.counter.name,
        startingFloatPKR: paisaToRupees(s.openingFloat),
        openingFloatPKR: paisaToRupees(s.openingFloat),
        expectedCashInDrawerPKR: paisaToRupees(s.expectedCash),
        expectedCashPKR: paisaToRupees(s.expectedCash),
        actualCashPKR: s.actualCash ? paisaToRupees(s.actualCash) : null,
        overShortDiffPKR: s.overShortDiff ? paisaToRupees(s.overShortDiff) : null,
        movements: s.cashMovements.map((m) => ({
          ...m,
          type: m.type === CashDrawerAdjustmentType.CASH_IN ? 'cash_in' : 'cash_out',
          amountPKR: paisaToRupees(m.amount),
        })),
      })),
      meta: {
        page: query?.page || 1,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
