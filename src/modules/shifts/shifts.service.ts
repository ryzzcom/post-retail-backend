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
import {
  ShiftStatus,
  PaymentMethod,
  ExpensePaidFrom,
  CashDrawerAdjustmentType,
} from '@prisma/client';

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

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
      throw new BadRequestException('Cashier already has an open shift in progress');
    }

    const openingFloatPaisa = rupeesToPaisa(dto.openingFloat);

    const shift = await this.prisma.cashierShift.create({
      data: {
        storeId,
        counterId: dto.counterId,
        cashierId,
        openingFloat: openingFloatPaisa,
        expectedCash: openingFloatPaisa,
        status: ShiftStatus.OPEN,
        notes: dto.notes,
      },
      include: {
        counter: true,
      },
    });

    return {
      ...shift,
      openingFloatPKR: paisaToRupees(shift.openingFloat),
      expectedCashPKR: paisaToRupees(shift.expectedCash),
    };
  }

  async getCurrentShift(storeId: string, cashierId: string) {
    const shift = await this.prisma.cashierShift.findFirst({
      where: {
        storeId,
        cashierId,
        status: ShiftStatus.OPEN,
      },
      include: {
        counter: true,
      },
    });

    if (!shift) {
      return null;
    }

    // Tally current cash sales, cash expenses, and drawer movements during this shift
    const [cashOrders, cashExpenses, cashMovements] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          storeId,
          method: PaymentMethod.CASH,
          order: { shiftId: shift.id },
        },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          storeId,
          shiftId: shift.id,
          paidFrom: ExpensePaidFrom.CASH_DRAWER,
        },
        _sum: { paidAmount: true },
      }),
      this.prisma.shiftCashMovement.findMany({
        where: {
          storeId,
          shiftId: shift.id,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const cashCollected = cashOrders._sum.amount || 0n;
    const cashPaidOut = cashExpenses._sum.paidAmount || 0n;
    const totalCashIn = cashMovements
      .filter((m) => m.type === CashDrawerAdjustmentType.CASH_IN)
      .reduce((sum, m) => sum + m.amount, 0n);
    const totalCashOut = cashMovements
      .filter((m) => m.type === CashDrawerAdjustmentType.CASH_OUT)
      .reduce((sum, m) => sum + m.amount, 0n);

    const currentExpectedCash =
      shift.openingFloat + cashCollected - cashPaidOut + totalCashIn - totalCashOut;

    return {
      ...shift,
      currentExpectedCash,
      cashCollected,
      cashPaidOut,
      openingFloatPKR: paisaToRupees(shift.openingFloat),
      expectedCashPKR: paisaToRupees(currentExpectedCash),
      cashCollectedPKR: paisaToRupees(cashCollected),
      cashPaidOutPKR: paisaToRupees(cashPaidOut),
      totalCashInPKR: paisaToRupees(totalCashIn),
      totalCashOutPKR: paisaToRupees(totalCashOut),
      movements: cashMovements.map((m) => ({
        id: m.id,
        type: m.type,
        amountPKR: paisaToRupees(m.amount),
        reason: m.reason,
        notes: m.notes,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /**
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
      type: movement.type,
      amountPKR: paisaToRupees(movement.amount),
      reason: movement.reason,
      notes: movement.notes,
      newExpectedCashPKR: paisaToRupees(newExpectedCash),
      createdAt: movement.createdAt.toISOString(),
    };
  }

  async closeShift(
    storeId: string,
    shiftId: string,
    cashierId: string,
    dto: CloseShiftDto,
  ) {
    const shift = await this.prisma.cashierShift.findFirst({
      where: { id: shiftId, storeId, status: ShiftStatus.OPEN },
    });

    if (!shift) {
      throw new NotFoundException('Open shift not found');
    }

    // Tally cash orders, cash expenses, and drawer movements
    const [cashOrders, cashExpenses, cashMovements] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          storeId,
          method: PaymentMethod.CASH,
          order: { shiftId },
        },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          storeId,
          shiftId,
          paidFrom: ExpensePaidFrom.CASH_DRAWER,
        },
        _sum: { paidAmount: true },
      }),
      this.prisma.shiftCashMovement.findMany({
        where: {
          storeId,
          shiftId,
        },
      }),
    ]);

    const cashCollected = cashOrders._sum.amount || 0n;
    const cashPaidOut = cashExpenses._sum.paidAmount || 0n;
    const totalCashIn = cashMovements
      .filter((m) => m.type === CashDrawerAdjustmentType.CASH_IN)
      .reduce((sum, m) => sum + m.amount, 0n);
    const totalCashOut = cashMovements
      .filter((m) => m.type === CashDrawerAdjustmentType.CASH_OUT)
      .reduce((sum, m) => sum + m.amount, 0n);

    const expectedCash =
      shift.openingFloat + cashCollected - cashPaidOut + totalCashIn - totalCashOut;
    const actualCashPaisa = rupeesToPaisa(dto.actualCash);
    const overShortDiff = actualCashPaisa - expectedCash;

    const updated = await this.prisma.cashierShift.update({
      where: { id: shiftId },
      data: {
        expectedCash,
        actualCash: actualCashPaisa,
        overShortDiff,
        status: ShiftStatus.CLOSED,
        closedAt: new Date(),
        notes: dto.notes,
      },
    });

    return {
      ...updated,
      openingFloatPKR: paisaToRupees(updated.openingFloat),
      expectedCashPKR: paisaToRupees(updated.expectedCash),
      actualCashPKR: paisaToRupees(updated.actualCash || 0n),
      overShortDiffPKR: paisaToRupees(updated.overShortDiff || 0n),
    };
  }

  async listShifts(
    storeId: string,
    query?: PaginationQueryDto,
  ) {
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
        openingFloatPKR: paisaToRupees(s.openingFloat),
        expectedCashPKR: paisaToRupees(s.expectedCash),
        actualCashPKR: s.actualCash ? paisaToRupees(s.actualCash) : null,
        overShortDiffPKR: s.overShortDiff ? paisaToRupees(s.overShortDiff) : null,
        movements: s.cashMovements.map((m) => ({
          ...m,
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
