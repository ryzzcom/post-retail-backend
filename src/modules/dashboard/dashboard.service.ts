import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@core/redis/redis.service';
import { paisaToRupees } from '@core/utils/currency-paisa.util';
import {
  DashboardPeriod,
  DashboardPeriodQueryDto,
  TopVariantsQueryDto,
  getPeriodDateRange,
} from './dto/dashboard-query.dto';
import {
  OrderStatus,
  PaymentMethod,
  ShiftStatus,
  KhataTransactionType,
  ExpensePaymentMethod,
} from '@prisma/client';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  private readonly CACHE_TTL_SECONDS = 30; // 30-second cache for rapid tab switching

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Helper to retrieve cached JSON data from Redis
   */
  private async getFromCache<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redisService.get(key);
      if (cached) {
        return JSON.parse(cached) as T;
      }
    } catch (err: any) {
      this.logger.warn(`Redis cache get error for ${key}: ${err.message}`);
    }
    return null;
  }

  /**
   * Helper to save JSON data to Redis
   */
  private async saveToCache(key: string, data: any): Promise<void> {
    try {
      await this.redisService.set(
        key,
        JSON.stringify(data),
        this.CACHE_TTL_SECONDS,
      );
    } catch (err: any) {
      this.logger.warn(`Redis cache set error for ${key}: ${err.message}`);
    }
  }

  /**
   * 1. GET /api/v1/dashboard/sales-profit?period=today|week|mtd
   * Top Hero Card: Net Sales, Profit Breakdown, Payment Split & Revenue Trend Chart
   */
  async getSalesProfit(storeId: string, period: DashboardPeriod = 'today') {
    const cacheKey = `dashboard:${storeId}:sales-profit:${period}`;
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    const { startDate, endDate } = getPeriodDateRange(period);

    // Parallel aggregations
    const [orders, refundedOrders, expenses] = await Promise.all([
      // Completed orders in period
      this.prisma.order.findMany({
        where: {
          storeId,
          status: OrderStatus.COMPLETED,
          createdAt: { gte: startDate, lte: endDate },
        },
        select: {
          id: true,
          subtotal: true,
          discount: true,
          grandTotal: true,
          createdAt: true,
          items: {
            select: {
              quantity: true,
              variant: {
                select: {
                  costPrice: true,
                },
              },
            },
          },
          payments: {
            select: {
              method: true,
              amount: true,
            },
          },
        },
      }),

      // Refunded orders in period
      this.prisma.order.aggregate({
        where: {
          storeId,
          status: OrderStatus.REFUNDED,
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: {
          grandTotal: true,
        },
      }),

      // Operating expenses in period
      this.prisma.expense.aggregate({
        where: {
          storeId,
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: {
          expenseAmount: true,
        },
      }),
    ]);

    // Sales Calculations
    const ordersCount = orders.length;
    const grossSalesPaisa = orders.reduce((acc, o) => acc + o.subtotal, 0n);
    const discountsPaisa = orders.reduce((acc, o) => acc + o.discount, 0n);
    const returnsPaisa = refundedOrders._sum.grandTotal ?? 0n;

    const completedGrandTotalPaisa = orders.reduce(
      (acc, o) => acc + o.grandTotal,
      0n,
    );
    const netSalesPaisa = completedGrandTotalPaisa - returnsPaisa;

    const grossSales = paisaToRupees(grossSalesPaisa);
    const discounts = paisaToRupees(discountsPaisa);
    const returns = paisaToRupees(returnsPaisa);
    const netSales = paisaToRupees(netSalesPaisa > 0n ? netSalesPaisa : 0n);
    const aov =
      ordersCount > 0 ? Number((netSales / ordersCount).toFixed(2)) : 0;

    // COGS & Profit Calculations
    const cogsPaisa = orders.reduce((totalCogs, order) => {
      const orderCogs = order.items.reduce((itemAcc, item) => {
        const costPrice = item.variant?.costPrice ?? 0n;
        return itemAcc + BigInt(item.quantity) * costPrice;
      }, 0n);
      return totalCogs + orderCogs;
    }, 0n);

    const cogs = paisaToRupees(cogsPaisa);
    const grossProfit = Number((netSales - cogs).toFixed(2));
    const grossMarginPct =
      netSales > 0 ? Number(((grossProfit / netSales) * 100).toFixed(1)) : 0;

    const expensesPaisa = expenses._sum.expenseAmount ?? 0n;
    const expensesRupees = paisaToRupees(expensesPaisa);
    const estimatedOperatingProfit = Number(
      (grossProfit - expensesRupees).toFixed(2),
    );

    // Payment Method Breakdown
    let cashPaisa = 0n;
    let cardDigitalPaisa = 0n;
    let khataPaisa = 0n;

    for (const order of orders) {
      for (const payment of order.payments) {
        if (payment.method === PaymentMethod.CASH) {
          cashPaisa += payment.amount;
        } else if (
          payment.method === PaymentMethod.CARD ||
          (payment.method as string) === 'BANK_TRANSFER'
        ) {
          cardDigitalPaisa += payment.amount;
        } else if (payment.method === PaymentMethod.KHATA) {
          khataPaisa += payment.amount;
        }
      }
    }

    const paymentSplit = {
      cash: paisaToRupees(cashPaisa),
      cardDigital: paisaToRupees(cardDigitalPaisa),
      khata: paisaToRupees(khataPaisa),
    };

    // Revenue Trend Series (Chart)
    const chartSeries = this.buildChartSeries(period, orders, startDate, endDate);

    const result = {
      period,
      sales: {
        netSales,
        grossSales,
        discounts,
        returns,
        ordersCount,
        aov,
      },
      profit: {
        cogs,
        grossProfit,
        grossMarginPct,
        expenses: expensesRupees,
        estimatedOperatingProfit,
      },
      paymentSplit,
      chartSeries,
    };

    await this.saveToCache(cacheKey, result);
    return result;
  }

  /**
   * Builds chart series buckets based on period
   */
  private buildChartSeries(
    period: DashboardPeriod,
    orders: Array<{ grandTotal: bigint; createdAt: Date }>,
    startDate: Date,
    endDate: Date,
  ): Array<{ label: string; revenue: number }> {
    const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

    if (period === 'today') {
      // Hourly retail buckets: 10a, 11a, 12p, 1p, ..., 11p
      const hours = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
      const buckets = new Map<number, number>();
      for (const h of hours) {
        buckets.set(h, 0);
      }

      for (const order of orders) {
        const pktDate = new Date(order.createdAt.getTime() + PKT_OFFSET_MS);
        const hour = pktDate.getUTCHours();
        const current = buckets.get(hour) ?? 0;
        buckets.set(hour, current + paisaToRupees(order.grandTotal));
      }

      return hours.map((h) => {
        const ampm = h >= 12 ? 'p' : 'a';
        const displayH = h % 12 === 0 ? 12 : h % 12;
        return {
          label: `${displayH}${ampm}`,
          revenue: Number((buckets.get(h) ?? 0).toFixed(2)),
        };
      });
    }

    if (period === 'week') {
      // Daily buckets: Mon, Tue, Wed, Thu, Fri, Sat, Sun
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const buckets = new Map<string, number>();
      for (const d of days) {
        buckets.set(d, 0);
      }

      for (const order of orders) {
        const pktDate = new Date(order.createdAt.getTime() + PKT_OFFSET_MS);
        const dayIdx = pktDate.getUTCDay(); // 0 = Sun, 1 = Mon...
        // Map 0 -> 'Sun', 1 -> 'Mon'...
        const dayName = days[dayIdx === 0 ? 6 : dayIdx - 1];
        const current = buckets.get(dayName) ?? 0;
        buckets.set(dayName, current + paisaToRupees(order.grandTotal));
      }

      return days.map((d) => ({
        label: d,
        revenue: Number((buckets.get(d) ?? 0).toFixed(2)),
      }));
    }

    // period === 'mtd'
    // Daily buckets for month to date
    const pktNow = new Date(endDate.getTime() + PKT_OFFSET_MS);
    const currentDay = pktNow.getUTCDate();
    const monthName = pktNow.toLocaleString('en-US', {
      month: 'short',
      timeZone: 'UTC',
    });

    const buckets = new Map<number, number>();
    for (let day = 1; day <= currentDay; day++) {
      buckets.set(day, 0);
    }

    for (const order of orders) {
      const pktDate = new Date(order.createdAt.getTime() + PKT_OFFSET_MS);
      const day = pktDate.getUTCDate();
      if (buckets.has(day)) {
        const current = buckets.get(day) ?? 0;
        buckets.set(day, current + paisaToRupees(order.grandTotal));
      }
    }

    const series: Array<{ label: string; revenue: number }> = [];
    for (let day = 1; day <= currentDay; day++) {
      series.push({
        label: `${monthName} ${day}`,
        revenue: Number((buckets.get(day) ?? 0).toFixed(2)),
      });
    }

    return series;
  }

  /**
   * 2. GET /api/v1/dashboard/financial-position
   * Live Balance Strip (Point-in-time live snapshot)
   */
  async getFinancialPosition(storeId: string) {
    const cacheKey = `dashboard:${storeId}:financial-position`;
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    const [openShifts, cardPayments, bankExpenses, khataSum] =
      await Promise.all([
        // Active open cashier shifts
        this.prisma.cashierShift.findMany({
          where: { storeId, status: ShiftStatus.OPEN },
          select: {
            expectedCash: true,
            openingFloat: true,
          },
        }),

        // Settled card/digital payments
        this.prisma.payment.aggregate({
          where: { storeId, method: PaymentMethod.CARD },
          _sum: { amount: true },
        }),

        // Bank expenses
        this.prisma.expense.aggregate({
          where: {
            storeId,
            paymentMethod: ExpensePaymentMethod.BANK,
          },
          _sum: { expenseAmount: true },
        }),

        // Customers who owe money (currentKhataBalance > 0)
        this.prisma.customer.aggregate({
          where: {
            storeId,
            currentKhataBalance: { gt: 0n },
          },
          _sum: { currentKhataBalance: true },
        }),
      ]);

    // Cash drawer expected cash
    const cashDrawerPaisa = openShifts.reduce((acc, s) => {
      const shiftCash = s.expectedCash > 0n ? s.expectedCash : s.openingFloat;
      return acc + shiftCash;
    }, 0n);

    // Petty cash float across open shifts
    const pettyCashPaisa = openShifts.reduce(
      (acc, s) => acc + s.openingFloat,
      0n,
    );

    // Digital bank settlement balance
    const digitalIn = cardPayments._sum.amount ?? 0n;
    const digitalOut = bankExpenses._sum.expenseAmount ?? 0n;
    const bankBalancePaisa = digitalIn > digitalOut ? digitalIn - digitalOut : 0n;

    const customersOwePaisa = khataSum._sum.currentKhataBalance ?? 0n;

    const result = {
      cashDrawerNow: paisaToRupees(cashDrawerPaisa),
      bankBalance: paisaToRupees(bankBalancePaisa),
      pettyCash: paisaToRupees(pettyCashPaisa),
      customersOweYou: paisaToRupees(customersOwePaisa),
      youOweSuppliers: 0, // Extensible supplier bill tracking
    };

    await this.saveToCache(cacheKey, result);
    return result;
  }

  /**
   * 3. GET /api/v1/dashboard/attention-alerts
   * Actionable Store Alerts ("Needs your attention" Card)
   */
  async getAttentionAlerts(storeId: string) {
    const cacheKey = `dashboard:${storeId}:attention-alerts`;
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [lowStockVariants, overdueCustomersCount, store] = await Promise.all([
      // Low stock variants where quantityOnHand <= lowStockThreshold
      this.prisma.$queryRaw<
        Array<{
          variantId: string;
          productName: string;
          sku: string;
          quantityOnHand: number;
          lowStockThreshold: number;
        }>
      >`
        SELECT si."variantId", p.name AS "productName", pv.sku, si."quantityOnHand", si."lowStockThreshold"
        FROM store_inventory si
        JOIN product_variants pv ON si."variantId" = pv.id
        JOIN products p ON pv."productId" = p.id
        WHERE si."storeId" = ${storeId} AND si."quantityOnHand" <= si."lowStockThreshold"
        ORDER BY si."quantityOnHand" ASC
        LIMIT 10
      `,

      // Overdue khata: customers with balance > 0 and purchase older than 30 days
      this.prisma.customer.count({
        where: {
          storeId,
          currentKhataBalance: { gt: 0n },
          khataLedgers: {
            some: {
              type: KhataTransactionType.DEBIT_PURCHASE,
              createdAt: { lte: thirtyDaysAgo },
            },
          },
        },
      }),

      // Store metadata for subscription/trial tracking
      this.prisma.store.findUnique({
        where: { id: storeId },
        select: { createdAt: true },
      }),
    ]);

    const lowStockCount = lowStockVariants.length;
    const lowStockPreview = lowStockVariants
      .slice(0, 3)
      .map((item) => `${item.productName} · ${item.sku}`);

    // Trial calculation (14 days default from store creation)
    const daysSinceCreation = store
      ? Math.floor(
          (Date.now() - store.createdAt.getTime()) / (1000 * 60 * 60 * 24),
        )
      : 0;
    const daysRemaining = Math.max(0, 14 - daysSinceCreation);

    // Structured Alerts Array for frontend widget rendering
    const alerts: Array<{
      id: string;
      type: string;
      severity: 'warning' | 'danger' | 'info';
      title: string;
      description: string;
      count?: number;
    }> = [];

    if (lowStockCount > 0) {
      alerts.push({
        id: 'low-stock-alert',
        type: 'LOW_STOCK',
        severity: 'warning',
        title: `${lowStockCount} Item${lowStockCount > 1 ? 's' : ''} Low in Stock`,
        description: lowStockPreview.join(', '),
        count: lowStockCount,
      });
    }

    if (overdueCustomersCount > 0) {
      alerts.push({
        id: 'overdue-khata-alert',
        type: 'OVERDUE_KHATA',
        severity: 'danger',
        title: `${overdueCustomersCount} Overdue Khata Customer${overdueCustomersCount > 1 ? 's' : ''}`,
        description: 'Past 30-day payment terms',
        count: overdueCustomersCount,
      });
    }

    alerts.push({
      id: 'subscription-trial-alert',
      type: 'SUBSCRIPTION_TRIAL',
      severity: daysRemaining <= 3 ? 'danger' : 'info',
      title: 'Store Trial Status',
      description: `${daysRemaining} days remaining in trial period`,
      count: daysRemaining,
    });

    const result = {
      lowStockVariants: {
        count: lowStockCount,
        items: lowStockPreview,
      },
      overdueKhata: {
        count: overdueCustomersCount,
        subtitle: 'Past 30-day terms',
      },
      unpaidBills: {
        count: 0,
        totalAmount: 0,
        nextDueLabel: null,
      },
      failedWhatsAppReceipts: {
        count: 0,
        reason: null,
      },
      subscriptionTrial: {
        isTrial: true,
        daysRemaining,
      },
      alerts,
    };

    await this.saveToCache(cacheKey, result);
    return result;
  }

  /**
   * 4. GET /api/v1/dashboard/top-variants?period=today|week|mtd&limit=5
   * Top-selling variants table + Customer/Loyalty Header Strip
   */
  async getTopVariants(storeId: string, query: TopVariantsQueryDto) {
    const period = query.period || 'today';
    const limit = query.limit || 5;
    const cacheKey = `dashboard:${storeId}:top-variants:${period}:${limit}`;
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    const { startDate, endDate } = getPeriodDateRange(period);

    // Parallel queries
    const [newCustomersCount, periodOrdersWithCustomers, topItems] =
      await Promise.all([
        // New customers acquired in this period
        this.prisma.customer.count({
          where: {
            storeId,
            createdAt: { gte: startDate, lte: endDate },
          },
        }),

        // Distinct customer orders in this period
        this.prisma.order.findMany({
          where: {
            storeId,
            status: OrderStatus.COMPLETED,
            customerId: { not: null },
            createdAt: { gte: startDate, lte: endDate },
          },
          select: { customerId: true },
          distinct: ['customerId'],
        }),

        // Top variants by revenue sold in completed orders
        this.prisma.orderItem.groupBy({
          by: ['variantId'],
          where: {
            storeId,
            order: {
              status: OrderStatus.COMPLETED,
              createdAt: { gte: startDate, lte: endDate },
            },
          },
          _sum: {
            quantity: true,
            total: true,
          },
          orderBy: {
            _sum: {
              total: 'desc',
            },
          },
          take: limit,
        }),
      ]);

    // Repeat customers calculation (had prior completed order before this period)
    const customerIds = periodOrdersWithCustomers
      .map((o) => o.customerId)
      .filter(Boolean) as string[];

    let repeatCustomersCount = 0;
    if (customerIds.length > 0) {
      const priorOrders = await this.prisma.order.findMany({
        where: {
          storeId,
          customerId: { in: customerIds },
          createdAt: { lt: startDate },
        },
        select: { customerId: true },
        distinct: ['customerId'],
      });
      repeatCustomersCount = priorOrders.length;
    }

    // Fetch variant and product metadata for top items
    const variantIds = topItems.map((i) => i.variantId);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: {
        product: {
          select: { name: true },
        },
      },
    });

    const variantMap = new Map(variants.map((v) => [v.id, v]));

    const items = topItems.map((item) => {
      const v = variantMap.get(item.variantId);
      const productName = v?.product?.name ?? 'Standard Product';
      const sku = v?.sku ?? 'SKU-N/A';
      const variantLabel = `${productName} · ${sku}`;
      const unitsSold = item._sum.quantity ?? 0;
      const revenue = paisaToRupees(item._sum.total ?? 0n);

      return {
        variantId: item.variantId,
        productName,
        variantLabel,
        sku,
        unitsSold,
        revenue,
      };
    });

    const result = {
      period,
      customerLoyalty: {
        newCustomersCount,
        repeatCustomersCount,
        pointsIssued: 0,
        pointsRedeemed: 0,
      },
      items,
    };

    await this.saveToCache(cacheKey, result);
    return result;
  }

  /**
   * Optional Unified Aggregator: GET /api/v1/dashboard/overview?period=today|week|mtd
   */
  async getOverview(storeId: string, period: DashboardPeriod = 'today') {
    const cacheKey = `dashboard:${storeId}:overview:${period}`;
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    const [salesProfit, financialPosition, attentionAlerts, topVariants] =
      await Promise.all([
        this.getSalesProfit(storeId, period),
        this.getFinancialPosition(storeId),
        this.getAttentionAlerts(storeId),
        this.getTopVariants(storeId, { period, limit: 5 }),
      ]);

    const result = {
      period,
      salesProfit,
      financialPosition,
      attentionAlerts,
      topVariants,
    };

    await this.saveToCache(cacheKey, result);
    return result;
  }
}
