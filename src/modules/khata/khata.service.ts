import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RecordKhataPaymentDto } from './dto/record-khata-payment.dto';
import { AdjustCreditLimitDto } from './dto/adjust-credit-limit.dto';
import { WhatsAppReminderDto } from './dto/whatsapp-reminder.dto';
import { KhataQueryDto } from './dto/khata-query.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import {
  paisaToRupees,
  rupeesToPaisa,
  calculatePercentageShare,
} from '@core/utils/currency-paisa.util';
import { formatDate, calculateDaysElapsedPkt } from '@core/utils/date-time.util';
import { objectsToCsv } from '@core/utils/csv-parser.util';
import { RedisService } from '@core/redis/redis.service';
import {
  KhataTransactionType,
  ShiftStatus,
  WhatsappStatus,
  WhatsAppMessageCategory,
} from '@prisma/client';

@Injectable()
export class KhataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 1. GET /api/v1/khata/accounts
   * Complete Khata Overview: Aging strip, filter counts, cashier metrics, and paginated accounts
   */
  async getKhataOverview(storeId: string, query: KhataQueryDto) {
    const customers = await this.prisma.customer.findMany({
      where: { storeId, isActive: true },
      include: {
        khataLedgers: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
      orderBy: { currentKhataBalance: 'desc' },
    });

    const now = new Date();

    // Map all accounts with aging computations
    const allAccounts = customers.map((c) => {
      const balancePaisa = c.currentKhataBalance;
      const balancePKR = paisaToRupees(balancePaisa);
      const creditLimitPKR = paisaToRupees(c.creditLimit);
      const limitUsedPercent = calculatePercentageShare(balancePaisa, c.creditLimit);

      // Find oldest open debit ledger entry if balance > 0
      let oldestOpenDate = c.createdAt;
      let oldestOpenDays = 0;

      if (balancePaisa > 0n) {
        const debitEntries = c.khataLedgers.filter(
          (l) => l.type === KhataTransactionType.DEBIT_PURCHASE,
        );
        if (debitEntries.length > 0) {
          // oldest debit entry is the last in descending list
          const oldestEntry = debitEntries[debitEntries.length - 1];
          oldestOpenDate = oldestEntry.createdAt;
          oldestOpenDays = calculateDaysElapsedPkt(oldestOpenDate);
        }
      }

      // Determine Status
      const termsDays = 30;
      let status: 'overdue' | 'within_terms' | 'settled' = 'within_terms';
      if (balancePaisa <= 0n) {
        status = 'settled';
      } else if (oldestOpenDays > termsDays) {
        status = 'overdue';
      } else {
        status = 'within_terms';
      }

      const lastPayment = c.khataLedgers.find(
        (l) => l.type === KhataTransactionType.CREDIT_PAYMENT,
      );
      const lastPurchase = c.khataLedgers.find(
        (l) => l.type === KhataTransactionType.DEBIT_PURCHASE,
      );

      return {
        id: c.id,
        customerId: c.id,
        customerName: c.name,
        customerPhone: c.phone,
        status,
        oldestOpenDate: formatDate(oldestOpenDate),
        oldestOpenDateRaw: oldestOpenDate,
        oldestOpenDays,
        creditLimit: creditLimitPKR,
        balance: balancePKR,
        balancePaisa,
        limitUsedPercent,
        lastPaymentDate: lastPayment ? formatDate(lastPayment.createdAt) : undefined,
        lastPurchaseDate: lastPurchase ? formatDate(lastPurchase.createdAt) : undefined,
        lastReminderSentAt: undefined,
      };
    });

    // Compute Aging Metrics
    let totalReceivablePaisa = 0n;
    let totalOverduePaisa = 0n;
    let withinTermsPaisa = 0n;
    let overdue1to30Paisa = 0n;
    let overdue31PlusPaisa = 0n;
    let overdueAccountsCount = 0;

    for (const acc of allAccounts) {
      if (acc.balancePaisa > 0n) {
        totalReceivablePaisa += acc.balancePaisa;

        if (acc.status === 'overdue') {
          totalOverduePaisa += acc.balancePaisa;
          overdueAccountsCount++;

          // 1-30 days overdue past terms (i.e. days open 31-60)
          if (acc.oldestOpenDays <= 60) {
            overdue1to30Paisa += acc.balancePaisa;
          } else {
            overdue31PlusPaisa += acc.balancePaisa;
          }
        } else if (acc.status === 'within_terms') {
          withinTermsPaisa += acc.balancePaisa;
        }
      }
    }

    // Filter counts
    const filterCounts = {
      all: allAccounts.length,
      overdue: allAccounts.filter((a) => a.status === 'overdue').length,
      within_terms: allAccounts.filter((a) => a.status === 'within_terms').length,
      settled: allAccounts.filter((a) => a.status === 'settled').length,
    };

    // Cashier Summary: Total Collected Today
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayCollections = await this.prisma.khataLedger.aggregate({
      where: {
        storeId,
        type: KhataTransactionType.CREDIT_PAYMENT,
        createdAt: { gte: startOfToday },
      },
      _sum: { amount: true },
    });

    const cashierSummary = {
      totalAccounts: allAccounts.length,
      overdueCount: overdueAccountsCount,
      totalOutstandingPKR: paisaToRupees(totalReceivablePaisa),
      collectedTodayPKR: paisaToRupees(todayCollections._sum.amount ?? 0n),
    };

    const agingSummary = {
      totalReceivable: paisaToRupees(totalReceivablePaisa),
      totalOverdue: paisaToRupees(totalOverduePaisa),
      withinTermsAmount: paisaToRupees(withinTermsPaisa),
      overdue1to30Amount: paisaToRupees(overdue1to30Paisa),
      overdue31PlusAmount: paisaToRupees(overdue31PlusPaisa),
      totalAccountsCount: allAccounts.length,
      overdueAccountsCount,
    };

    // Filter by Tab/Status
    let filtered = allAccounts;
    const statusFilter = (query.status || 'all').toLowerCase();
    if (statusFilter !== 'all') {
      filtered = filtered.filter((a) => a.status === statusFilter);
    }

    // Filter by Search
    if (query.search && query.search.trim()) {
      const q = query.search.trim().toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.customerName.toLowerCase().includes(q) ||
          a.customerPhone.toLowerCase().includes(q),
      );
    }

    // Paginate
    const page = query.page || 1;
    const limit = query.limit || 20;
    const startIndex = (page - 1) * limit;
    const paginatedItems = filtered.slice(startIndex, startIndex + limit);

    return {
      agingSummary,
      filterCounts,
      cashierSummary,
      items: paginatedItems,
      meta: {
        page,
        limit,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / limit),
      },
    };
  }

  /**
   * 2. GET /api/v1/khata/export
   * Universal CSV Export of Khata accounts
   */
  async exportKhataCsv(storeId: string): Promise<string> {
    const overview = await this.getKhataOverview(storeId, { status: 'all', limit: 10000 } as any);

    const exportRows = overview.items.map((a) => ({
      'Customer Name': a.customerName,
      'Phone Number': a.customerPhone,
      'Status': a.status.toUpperCase(),
      'Outstanding Balance (PKR)': a.balance,
      'Credit Limit (PKR)': a.creditLimit,
      'Limit Used %': `${a.limitUsedPercent}%`,
      'Oldest Open Invoice': a.oldestOpenDate,
      'Days Open': a.oldestOpenDays,
      'Last Payment Date': a.lastPaymentDate || 'Never',
    }));

    return objectsToCsv(exportRows);
  }

  /**
   * 3. GET /api/v1/khata/:customerId/ledger
   * Powers Slide-Over KhataDetailDrawer
   */
  async getCustomerLedger(
    storeId: string,
    customerId: string,
    query?: PaginationQueryDto,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, storeId },
      include: {
        khataLedgers: {
          orderBy: { createdAt: 'desc' },
          skip: query?.skip || 0,
          take: query?.limit || 50,
          include: {
            order: { select: { receiptNo: true } },
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }

    const totalCount = await this.prisma.khataLedger.count({
      where: { storeId, customerId },
    });

    const balancePKR = paisaToRupees(customer.currentKhataBalance);
    const creditLimitPKR = paisaToRupees(customer.creditLimit);
    const limitUsedPercent = calculatePercentageShare(balancePKR, creditLimitPKR);

    const lastReminder = await this.prisma.whatsAppMessageLog.findFirst({
      where: {
        storeId,
        customerId: customer.id,
        category: WhatsAppMessageCategory.KHATA_REMINDER,
      },
      orderBy: { createdAt: 'desc' },
    });

    const account = {
      id: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      creditLimit: creditLimitPKR,
      balance: balancePKR,
      limitUsedPercent,
      city: customer.city,
      address: customer.address,
      styleTags: customer.styleTags,
      lastReminderSentAt: lastReminder ? formatDate(lastReminder.createdAt) : null,
    };

    const ledgerEntries = customer.khataLedgers.map((l) => {
      let type: 'credit_sale' | 'payment_received' | 'adjustment' = 'credit_sale';
      if (l.type === KhataTransactionType.CREDIT_PAYMENT) {
        type = 'payment_received';
      } else if (l.type === KhataTransactionType.ADJUSTMENT) {
        type = 'adjustment';
      }

      return {
        id: l.id,
        accountId: customer.id,
        type,
        date: formatDate(l.createdAt),
        amount: paisaToRupees(l.amount),
        balanceAfter: paisaToRupees(l.runningBalance),
        receiptNo: l.order?.receiptNo || l.referenceNo || `KH-${l.id.slice(0, 8)}`,
        description: l.notes || (type === 'credit_sale' ? 'Credit Purchase' : 'Payment Received'),
        paymentMethod: l.referenceNo?.startsWith('MBL-') ? 'Bank Transfer' : 'Cash',
      };
    });

    return {
      account,
      ledgerEntries,
      meta: {
        page: query?.page || 1,
        limit: query?.limit || 50,
        total: totalCount,
      },
    };
  }

  /**
   * 4. POST /api/v1/khata/payments
   * Record payment against Khata debt with drawer increment & audit trail
   */
  async recordPayment(
    storeId: string,
    dto: RecordKhataPaymentDto,
    cashierId?: string,
  ) {
    const targetCustomerId = dto.customerId || dto.accountId;
    if (!targetCustomerId) {
      throw new BadRequestException('Customer ID (or accountId) is required');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: targetCustomerId, storeId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${targetCustomerId} not found`);
    }

    const paymentAmountPaisa = rupeesToPaisa(dto.amount);
    const currentBalancePaisa = customer.currentKhataBalance;
    const newBalancePaisa =
      currentBalancePaisa > paymentAmountPaisa
        ? currentBalancePaisa - paymentAmountPaisa
        : 0n;

    return this.prisma.$transaction(async (tx) => {
      // 1. Create KhataLedger entry
      const ledgerEntry = await tx.khataLedger.create({
        data: {
          storeId,
          customerId: customer.id,
          type: KhataTransactionType.CREDIT_PAYMENT,
          amount: paymentAmountPaisa,
          runningBalance: newBalancePaisa,
          referenceNo: dto.referenceNo || dto.reference || null,
          notes: dto.notes || `Khata payment received via ${dto.paymentMethod || 'cash'}`,
        },
      });

      // 2. Decrement Customer currentKhataBalance
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          currentKhataBalance: newBalancePaisa,
        },
      });

      // 3. Increment active shift expected cash if paid via cash
      const isCash = !dto.paymentMethod || dto.paymentMethod.toLowerCase() === 'cash';
      if (isCash) {
        const activeShift = await tx.cashierShift.findFirst({
          where: { storeId, status: ShiftStatus.OPEN },
          orderBy: { openedAt: 'desc' },
        });

        if (activeShift) {
          await tx.cashierShift.update({
            where: { id: activeShift.id },
            data: {
              expectedCash: { increment: paymentAmountPaisa },
            },
          });
        }
      }

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          storeId,
          userId: cashierId || null,
          action: 'KHATA_PAYMENT_RECORDED',
          entity: 'Customer',
          entityId: customer.id,
          details: {
            customerName: customer.name,
            amountRupees: dto.amount,
            previousBalanceRupees: paisaToRupees(currentBalancePaisa),
            newBalanceRupees: paisaToRupees(newBalancePaisa),
            paymentMethod: dto.paymentMethod || 'cash',
            reference: dto.referenceNo || dto.reference,
          },
        },
      });

      // Invalidate Redis dashboard cache so receivables strip refreshes immediately
      await this.redisService.delPattern(`dashboard:${storeId}:*`);

      return {
        id: ledgerEntry.id,
        customerId: customer.id,
        customerName: customer.name,
        amount: dto.amount,
        remainingBalance: paisaToRupees(newBalancePaisa),
        referenceNo: ledgerEntry.referenceNo,
        recordedAt: ledgerEntry.createdAt.toISOString(),
      };
    });
  }

  /**
   * 5. PATCH /api/v1/khata/:customerId/credit-limit
   * Adjust customer credit limit
   */
  async adjustCreditLimit(
    storeId: string,
    customerId: string,
    dto: AdjustCreditLimitDto,
    userId?: string,
  ) {
    const targetId = customerId || dto.customerId || dto.accountId;
    if (!targetId) {
      throw new BadRequestException('Customer ID is required');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: targetId, storeId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${targetId} not found`);
    }

    const limitRupees = dto.creditLimit !== undefined ? dto.creditLimit : dto.newCreditLimit;
    if (limitRupees === undefined || limitRupees < 0) {
      throw new BadRequestException('Valid positive creditLimit is required');
    }

    const newLimitPaisa = rupeesToPaisa(limitRupees);

    const updated = await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        creditLimit: newLimitPaisa,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        storeId,
        userId: userId || null,
        action: 'CUSTOMER_CREDIT_LIMIT_UPDATED',
        entity: 'Customer',
        entityId: customer.id,
        details: {
          previousLimitRupees: paisaToRupees(customer.creditLimit),
          newLimitRupees: limitRupees,
          reason: dto.reason || 'Credit limit adjustment',
        },
      },
    });

    return {
      customerId: updated.id,
      customerName: updated.name,
      creditLimit: paisaToRupees(updated.creditLimit),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * 6. POST /api/v1/khata/:customerId/remind
   * Dispatch WhatsApp Payment Reminder & Update Timestamp
   */
  async sendPaymentReminder(
    storeId: string,
    customerId: string,
    dto: WhatsAppReminderDto,
    userId?: string,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, storeId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }

    const phone = dto.phone || customer.phone;
    const balancePKR = paisaToRupees(customer.currentKhataBalance);

    // Save Message Log in database and decrement message credit atomically if available
    const messageLog = await this.prisma.$transaction(async (tx) => {
      const log = await tx.whatsAppMessageLog.create({
        data: {
          storeId,
          customerId: customer.id,
          customerName: customer.name,
          customerPhone: phone,
          templateName: 'Khata Payment Reminder',
          message: dto.message,
          status: WhatsappStatus.DELIVERED,
          category: WhatsAppMessageCategory.KHATA_REMINDER,
        },
      });

      const config = await tx.whatsAppConfig.findUnique({
        where: { storeId },
      });
      if (config && config.availableCredits > 0) {
        await tx.whatsAppConfig.update({
          where: { id: config.id },
          data: { availableCredits: { decrement: 1 } },
        });
      }

      return log;
    });

    await this.prisma.auditLog.create({
      data: {
        storeId,
        userId: userId || null,
        action: 'WHATSAPP_REMINDER_SENT',
        entity: 'Customer',
        entityId: customer.id,
        details: {
          customerName: customer.name,
          phone,
          balancePKR,
          messageId: messageLog.id,
        },
      },
    });

    return {
      success: true,
      messageId: messageLog.id,
      customerName: customer.name,
      phone,
      balancePKR,
      sentAt: messageLog.createdAt.toISOString(),
    };
  }
}
