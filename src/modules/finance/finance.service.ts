import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { rupeesToPaisa } from '@core/utils/currency-paisa.util';

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async createExpense(storeId: string, userId: string, dto: CreateExpenseDto) {
    const expenseAmountPaisa = rupeesToPaisa(dto.expenseAmount);

    return this.prisma.expense.create({
      data: {
        storeId,
        shiftId: dto.shiftId,
        category: dto.category,
        expenseAmount: expenseAmountPaisa,
        description: dto.description,
        paymentMethod: dto.paymentMethod,
        recordedByUserId: userId,
      },
    });
  }

  async listExpenses(
    storeId: string,
    query?: PaginationQueryDto,
  ) {
    const where = {
      storeId,
    };

    const limit = query?.limit || 20;
    const skip = query?.skip || 0;

    const [total, items] = await Promise.all([
      this.prisma.expense.count({ where }),
      this.prisma.expense.findMany({
        where,
        include: {
          recordedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
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
