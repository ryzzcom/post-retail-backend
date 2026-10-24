import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RecordKhataPaymentDto } from './dto/record-khata-payment.dto';
import { AdjustCreditLimitDto } from './dto/adjust-credit-limit.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { rupeesToPaisa } from '@core/utils/currency-paisa.util';
import { KhataTransactionType } from '@prisma/client';

@Injectable()
export class KhataService {
  constructor(private readonly prisma: PrismaService) {}

  async recordPayment(storeId: string, dto: RecordKhataPaymentDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, storeId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${dto.customerId} not found`);
    }

    const paymentAmountPaisa = rupeesToPaisa(dto.amount);
    if (paymentAmountPaisa <= 0n) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    // Decrement customer Khata balance (CREDIT_PAYMENT reduces the debt)
    const newBalancePaisa = customer.currentKhataBalance - paymentAmountPaisa;

    return this.prisma.$transaction(async (tx) => {
      const ledgerEntry = await tx.khataLedger.create({
        data: {
          storeId,
          customerId: dto.customerId,
          type: KhataTransactionType.CREDIT_PAYMENT,
          amount: paymentAmountPaisa,
          runningBalance: newBalancePaisa,
          referenceNo: dto.referenceNo,
          notes: dto.notes,
        },
      });

      await tx.customer.update({
        where: { id: dto.customerId },
        data: {
          currentKhataBalance: newBalancePaisa,
        },
      });

      return ledgerEntry;
    });
  }

  async adjustCreditLimit(storeId: string, dto: AdjustCreditLimitDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, storeId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${dto.customerId} not found`);
    }

    const newLimitPaisa = rupeesToPaisa(dto.newCreditLimit);

    return this.prisma.customer.update({
      where: { id: dto.customerId },
      data: {
        creditLimit: newLimitPaisa,
      },
    });
  }

  async getCustomerLedger(
    storeId: string,
    customerId: string,
    query?: PaginationQueryDto,
  ) {
    const where = { storeId, customerId };
    const limit = query?.limit || 20;
    const skip = query?.skip || 0;

    const [total, items] = await Promise.all([
      this.prisma.khataLedger.count({ where }),
      this.prisma.khataLedger.findMany({
        where,
        include: {
          order: {
            select: { id: true, receiptNo: true, grandTotal: true, createdAt: true },
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

  async listKhataDebtors(storeId: string, query?: PaginationQueryDto) {
    const where = {
      storeId,
      currentKhataBalance: { gt: 0n },
    };

    const limit = query?.limit || 20;
    const skip = query?.skip || 0;

    const [total, items] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { currentKhataBalance: 'desc' },
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
