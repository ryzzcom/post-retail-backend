import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { rupeesToPaisa } from '@core/utils/currency-paisa.util';
import { ShiftStatus, PaymentMethod } from '@prisma/client';

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

    return this.prisma.cashierShift.create({
      data: {
        storeId,
        counterId: dto.counterId,
        cashierId,
        openingFloat: openingFloatPaisa,
        expectedCash: openingFloatPaisa,
        status: ShiftStatus.OPEN,
        notes: dto.notes,
      },
    });
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

    // Tally current cash sales and cash expenses during this shift
    const [cashOrders, cashExpenses] = await Promise.all([
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
        },
        _sum: { expenseAmount: true },
      }),
    ]);

    const cashCollected = cashOrders._sum.amount || 0n;
    const cashPaidOut = cashExpenses._sum.expenseAmount || 0n;
    const currentExpectedCash = shift.openingFloat + cashCollected - cashPaidOut;

    return {
      ...shift,
      currentExpectedCash,
      cashCollected,
      cashPaidOut,
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

    // Tally cash orders and expenses
    const [cashOrders, cashExpenses] = await Promise.all([
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
        },
        _sum: { expenseAmount: true },
      }),
    ]);

    const cashCollected = cashOrders._sum.amount || 0n;
    const cashPaidOut = cashExpenses._sum.expenseAmount || 0n;
    const expectedCash = shift.openingFloat + cashCollected - cashPaidOut;
    const actualCashPaisa = rupeesToPaisa(dto.actualCash);
    const overShortDiff = actualCashPaisa - expectedCash;

    return this.prisma.cashierShift.update({
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
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          counter: true,
        },
        orderBy: { openedAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: items,
      meta: {
        page: query?.page || 1,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
