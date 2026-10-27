import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import {
  CustomerFilter,
  CustomerQueryDto,
  CustomerSortBy,
} from './dto/customer-query.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  AdjustCustomerPointsDto,
  PointsAdjustmentMode,
} from './dto/adjust-customer-points.dto';
import { paisaToRupees, rupeesToPaisa } from '@core/utils/currency-paisa.util';
import { objectsToCsv } from '@core/utils/csv-parser.util';
import {
  CustomerTier,
  KhataTransactionType,
  OrderStatus,
  PointsTransactionType,
} from '@prisma/client';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Paginated Customers Table + Top Header Summary Strip
   */
  async listCustomers(storeId: string, query: CustomerQueryDto) {
    const where: any = { storeId, isActive: true };

    // Apply Filter Tab
    if (query.filter) {
      switch (query.filter) {
        case CustomerFilter.GOLD:
          where.tier = CustomerTier.GOLD;
          break;
        case CustomerFilter.SILVER:
          where.tier = CustomerTier.SILVER;
          break;
        case CustomerFilter.REGULAR:
          where.tier = CustomerTier.REGULAR;
          break;
        case CustomerFilter.HAS_KHATA:
          where.currentKhataBalance = { gt: 0n };
          break;
        case CustomerFilter.PROMOTIONS_OPT_IN:
          where.acceptsPromotions = true;
          break;
        case CustomerFilter.ALL:
        default:
          break;
      }
    }

    // Apply Search
    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' as const } },
        { phone: { contains: term, mode: 'insensitive' as const } },
        { styleTags: { contains: term, mode: 'insensitive' as const } },
      ];
    }

    // Apply Sort By
    let orderBy: any = { lifetimeSpend: 'desc' };
    if (query.sortBy) {
      switch (query.sortBy) {
        case CustomerSortBy.LOWEST_SPEND:
          orderBy = { lifetimeSpend: 'asc' };
          break;
        case CustomerSortBy.MOST_POINTS:
          orderBy = { loyaltyPoints: 'desc' };
          break;
        case CustomerSortBy.HIGHEST_KHATA:
          orderBy = { currentKhataBalance: 'desc' };
          break;
        case CustomerSortBy.RECENT_VISIT:
          orderBy = { lastVisitAt: 'desc' };
          break;
        case CustomerSortBy.NAME_ASC:
          orderBy = { name: 'asc' };
          break;
        case CustomerSortBy.HIGHEST_SPEND:
        default:
          orderBy = { lifetimeSpend: 'desc' };
          break;
      }
    }

    const [
      activeProfilesCount,
      acceptPromotionsCount,
      totalMatching,
      rawCustomers,
    ] = await Promise.all([
      // 1. Total Active Profiles in Store
      this.prisma.customer.count({
        where: { storeId, isActive: true },
      }),

      // 2. Total active customers that accept promotions
      this.prisma.customer.count({
        where: { storeId, isActive: true, acceptsPromotions: true },
      }),

      // 3. Total matching for pagination
      this.prisma.customer.count({ where }),

      // 4. Paginated Customer rows
      this.prisma.customer.findMany({
        where,
        orderBy,
        skip: query.skip,
        take: query.limit,
      }),
    ]);

    const items = rawCustomers.map((c) => {
      const stylePart = c.styleTags ? ` · ${c.styleTags}` : '';
      const subtitle = `${c.phone}${stylePart}`;

      let tierLabel = 'Regular';
      if (c.tier === CustomerTier.GOLD) tierLabel = 'Gold';
      else if (c.tier === CustomerTier.SILVER) tierLabel = 'Silver';

      let messagingStatus: 'All messages' | 'Service only' | 'Opted out' = 'Opted out';
      if (c.whatsappReceiptsOptIn && c.acceptsPromotions) {
        messagingStatus = 'All messages';
      } else if (c.whatsappReceiptsOptIn) {
        messagingStatus = 'Service only';
      }

      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        styleTags: c.styleTags,
        subtitle,
        tier: c.tier,
        tierLabel,
        lifetimeSpend: paisaToRupees(c.lifetimeSpend),
        points: c.loyaltyPoints,
        khataBalance: paisaToRupees(c.currentKhataBalance),
        hasKhata: c.currentKhataBalance > 0n,
        lastVisitFormatted: c.lastVisitAt ? formatDate(c.lastVisitAt) : null,
        messagingStatus,
        whatsappReceiptsOptIn: c.whatsappReceiptsOptIn,
        acceptsPromotions: c.acceptsPromotions,
      };
    });

    return {
      summary: {
        activeProfilesCount,
        acceptPromotionsCount,
        subtitle: `${activeProfilesCount} active profiles · ${acceptPromotionsCount} accept promotions`,
      },
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total: totalMatching,
        totalPages: Math.ceil(totalMatching / query.limit) || 1,
      },
    };
  }

  /**
   * Create New Customer Profile with Opening Khata & Tier Welcome Points
   */
  async createCustomer(storeId: string, dto: CreateCustomerDto) {
    const existing = await this.prisma.customer.findFirst({
      where: { storeId, phone: dto.phone.trim() },
    });

    if (existing) {
      throw new ConflictException(
        `Customer with phone number "${dto.phone}" already exists in this store`,
      );
    }

    const creditLimitPaisa = rupeesToPaisa(dto.creditLimit ?? 50000);
    const openingKhataPaisa = rupeesToPaisa(dto.openingKhataBalance || 0);

    const tier = dto.tier || CustomerTier.REGULAR;
    const welcomeTierPoints =
      tier === CustomerTier.GOLD ? 200 : tier === CustomerTier.SILVER ? 100 : 0;

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          storeId,
          name: dto.name.trim(),
          phone: dto.phone.trim(),
          email: dto.email?.trim() || null,
          styleTags: dto.styleTags?.trim() || null,
          tier,
          creditLimit: creditLimitPaisa,
          currentKhataBalance: openingKhataPaisa,
          loyaltyPoints: welcomeTierPoints,
          city: dto.city?.trim() || 'Lahore',
          address: dto.address?.trim() || null,
          styleNotes: dto.styleNotes?.trim() || null,
          acceptsPromotions: dto.acceptsPromotions ?? true,
          whatsappReceiptsOptIn: dto.whatsappReceiptsOptIn ?? true,
        },
      });

      // If initial opening khata balance > 0, log opening debit in KhataLedger
      if (openingKhataPaisa > 0n) {
        await tx.khataLedger.create({
          data: {
            storeId,
            customerId: customer.id,
            type: KhataTransactionType.DEBIT_PURCHASE,
            amount: openingKhataPaisa,
            runningBalance: openingKhataPaisa,
            notes: 'Opening Khata balance on customer registration',
          },
        });
      }

      // If tier bonus points > 0, log in PointsLedger
      if (welcomeTierPoints > 0) {
        await tx.pointsLedger.create({
          data: {
            storeId,
            customerId: customer.id,
            pointsChange: welcomeTierPoints,
            type: PointsTransactionType.TIER_BONUS,
            title: `${tier === CustomerTier.GOLD ? 'Gold' : 'Silver'} Tier Welcome Bonus`,
            description: 'Welcome bonus on customer profile creation',
          },
        });
      }

      return {
        ...customer,
        creditLimit: paisaToRupees(customer.creditLimit),
        currentKhataBalance: paisaToRupees(customer.currentKhataBalance),
        lifetimeSpend: paisaToRupees(customer.lifetimeSpend),
      };
    });
  }

  /**
   * Powers the Customer Detail Slide-Over Drawer (Overview & Points Tabs)
   * Strictly resolves by Customer :id
   */
  async getCustomerById(storeId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, storeId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID "${id}" not found`);
    }

    // Parallel fetch: Orders count & actual lifetime spend, recent receipts, and points history
    const [ordersCount, spendAggregate, recentOrders, pointsLedger] =
      await Promise.all([
        this.prisma.order.count({
          where: {
            storeId,
            customerId: id,
            status: { not: OrderStatus.CANCELLED },
          },
        }),
        this.prisma.order.aggregate({
          where: {
            storeId,
            customerId: id,
            status: { not: OrderStatus.CANCELLED },
          },
          _sum: { grandTotal: true },
        }),
        this.prisma.order.findMany({
          where: { storeId, customerId: id },
          include: {
            items: {
              include: {
                variant: {
                  include: {
                    product: { select: { id: true, name: true } },
                  },
                },
              },
              take: 1,
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        this.prisma.pointsLedger.findMany({
          where: { storeId, customerId: id },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

    const actualLifetimeSpend =
      spendAggregate._sum.grandTotal !== null && spendAggregate._sum.grandTotal !== undefined
        ? spendAggregate._sum.grandTotal
        : customer.lifetimeSpend;

    const memberSinceFormatted = formatDate(customer.createdAt);
    const headerSubtitle = `${customer.phone} · Member since ${memberSinceFormatted}`;

    let tierLabel = 'Regular';
    if (customer.tier === CustomerTier.GOLD) tierLabel = 'Gold';
    else if (customer.tier === CustomerTier.SILVER) tierLabel = 'Silver';

    const tagsArray = customer.styleTags
      ? customer.styleTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    const fullAddress = [customer.address, customer.city]
      .filter(Boolean)
      .join(', ') || null;

    const recentReceipts = recentOrders.map((o) => {
      const primaryItemName =
        o.items[0]?.variant?.product?.name || 'Retail Item';
      const orderDateFormatted = formatDate(o.createdAt);
      return {
        id: o.id,
        receiptNo: o.receiptNo,
        primaryItemName,
        dateFormatted: orderDateFormatted,
        subtitle: `${primaryItemName} · ${orderDateFormatted}`,
        grandTotal: paisaToRupees(o.grandTotal),
      };
    });

    const pointsHistory = pointsLedger.map((p) => {
      let badgeLabel = 'Earned';
      if (p.type === PointsTransactionType.REDEEMED) badgeLabel = 'Redeemed';
      else if (p.type === PointsTransactionType.MANUAL_ADJUSTMENT) badgeLabel = 'Manual';
      else if (p.type === PointsTransactionType.TIER_BONUS) badgeLabel = 'Tier Bonus';

      const isCredit = p.pointsChange >= 0;
      return {
        id: p.id,
        type: p.type,
        badgeLabel,
        direction: (isCredit ? 'CREDIT' : 'DEBIT') as 'CREDIT' | 'DEBIT',
        pointsChange: p.pointsChange,
        pointsFormatted: isCredit ? `+${p.pointsChange} pts` : `${p.pointsChange} pts`,
        title: p.title,
        description: p.description,
        dateFormatted: formatDate(p.createdAt),
      };
    });

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      memberSinceFormatted,
      headerSubtitle,
      overviewStats: {
        lifetimeSpend: paisaToRupees(actualLifetimeSpend),
        totalOrdersCount: ordersCount,
        loyaltyPoints: customer.loyaltyPoints,
        tier: tierLabel,
        khataBalance: paisaToRupees(customer.currentKhataBalance),
        creditLimit: paisaToRupees(customer.creditLimit),
        khataStatusLabel:
          customer.currentKhataBalance > 0n ? 'Receivable' : 'Settled',
      },
      contactInfo: {
        phone: customer.phone,
        email: customer.email,
        city: customer.city || 'Lahore',
        address: customer.address,
        fullAddress,
        styleTags: customer.styleTags,
        tagsArray,
      },
      preferences: {
        whatsappReceiptsOptIn: customer.whatsappReceiptsOptIn,
        acceptsPromotions: customer.acceptsPromotions,
        subscriptionLabel: customer.acceptsPromotions
          ? 'Subscribed to marketing'
          : 'Opted out',
      },
      styleNotes: customer.styleNotes,
      recentReceipts,
      pointsLoyalty: {
        availablePoints: customer.loyaltyPoints,
        transactionsCount: pointsHistory.length,
        history: pointsHistory,
      },
    };
  }

  /**
   * Search Customer by phone (fast POS scanner/phone lookup)
   */
  async searchByPhone(storeId: string, phone: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { storeId, phone: phone.trim() },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with phone "${phone}" not found`);
    }

    return {
      ...customer,
      creditLimit: paisaToRupees(customer.creditLimit),
      currentKhataBalance: paisaToRupees(customer.currentKhataBalance),
      lifetimeSpend: paisaToRupees(customer.lifetimeSpend),
    };
  }

  /**
   * Update Customer Profile, Style Notes & Communication Toggles
   * Strictly resolves by Customer :id
   */
  async updateCustomer(storeId: string, id: string, dto: UpdateCustomerDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, storeId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID "${id}" not found`);
    }

    // If phone is changing, ensure uniqueness
    if (dto.phone && dto.phone.trim() !== customer.phone) {
      const collision = await this.prisma.customer.findFirst({
        where: {
          storeId,
          phone: dto.phone.trim(),
          id: { not: id },
        },
      });
      if (collision) {
        throw new ConflictException(
          `Another customer with phone number "${dto.phone}" already exists`,
        );
      }
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.phone ? { phone: dto.phone.trim() } : {}),
        ...(dto.email !== undefined ? { email: dto.email?.trim() || null } : {}),
        ...(dto.styleTags !== undefined ? { styleTags: dto.styleTags?.trim() || null } : {}),
        ...(dto.tier ? { tier: dto.tier } : {}),
        ...(dto.creditLimit !== undefined
          ? { creditLimit: rupeesToPaisa(dto.creditLimit) }
          : {}),
        ...(dto.city !== undefined ? { city: dto.city?.trim() || null } : {}),
        ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
        ...(dto.styleNotes !== undefined ? { styleNotes: dto.styleNotes?.trim() || null } : {}),
        ...(dto.acceptsPromotions !== undefined
          ? { acceptsPromotions: dto.acceptsPromotions }
          : {}),
        ...(dto.whatsappReceiptsOptIn !== undefined
          ? { whatsappReceiptsOptIn: dto.whatsappReceiptsOptIn }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    return this.getCustomerById(storeId, updated.id);
  }

  /**
   * Manual Loyalty Points Adjustment (Credit or Deduction)
   * Strictly resolves by Customer :id
   */
  async adjustPoints(
    storeId: string,
    userId: string,
    customerId: string,
    dto: AdjustCustomerPointsDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, storeId },
      });

      if (!customer) {
        throw new NotFoundException(`Customer with ID "${customerId}" not found`);
      }

      if (
        dto.mode === PointsAdjustmentMode.DEDUCT &&
        customer.loyaltyPoints < dto.points
      ) {
        throw new BadRequestException(
          `Insufficient loyalty points. Customer has ${customer.loyaltyPoints} points, but deduction requires ${dto.points} points.`,
        );
      }

      const signedPoints =
        dto.mode === PointsAdjustmentMode.ADD ? dto.points : -dto.points;
      const newBalance = customer.loyaltyPoints + signedPoints;

      await tx.customer.update({
        where: { id: customerId },
        data: { loyaltyPoints: newBalance },
      });

      const entry = await tx.pointsLedger.create({
        data: {
          storeId,
          customerId,
          pointsChange: signedPoints,
          type: PointsTransactionType.MANUAL_ADJUSTMENT,
          title:
            dto.mode === PointsAdjustmentMode.ADD
              ? 'Manual Points Credit'
              : 'Manual Points Deduction',
          description: dto.reason,
          createdById: userId,
        },
      });

      return {
        success: true,
        customerId,
        newPointsBalance: newBalance,
        entry: {
          id: entry.id,
          type: entry.type,
          pointsChange: entry.pointsChange,
          title: entry.title,
          description: entry.description,
          createdAt: entry.createdAt.toISOString(),
        },
      };
    });
  }

  /**
   * Export Customers in clean universal CSV format
   */
  async exportCsv(storeId: string) {
    const customers = await this.prisma.customer.findMany({
      where: { storeId, isActive: true },
      orderBy: { name: 'asc' },
    });

    const headers = [
      'Customer ID',
      'Full Name',
      'Phone Number',
      'Email',
      'Loyalty Tier',
      'Style Tags',
      'Lifetime Spend (PKR)',
      'Loyalty Points',
      'Khata Balance (PKR)',
      'Credit Limit (PKR)',
      'Last Visit',
      'City',
      'Street Address',
      'WhatsApp Receipts',
      'Promotions Opt-In',
      'Style & Fitting Notes',
    ];

    const rows: Record<string, any>[] = customers.map((c) => ({
      'Customer ID': c.id,
      'Full Name': c.name,
      'Phone Number': c.phone,
      Email: c.email || '',
      'Loyalty Tier': c.tier,
      'Style Tags': c.styleTags || '',
      'Lifetime Spend (PKR)': paisaToRupees(c.lifetimeSpend),
      'Loyalty Points': c.loyaltyPoints,
      'Khata Balance (PKR)': paisaToRupees(c.currentKhataBalance),
      'Credit Limit (PKR)': paisaToRupees(c.creditLimit),
      'Last Visit': c.lastVisitAt ? formatDate(c.lastVisitAt) : 'Never',
      City: c.city || 'Lahore',
      'Street Address': c.address || '',
      'WhatsApp Receipts': c.whatsappReceiptsOptIn ? 'Yes' : 'No',
      'Promotions Opt-In': c.acceptsPromotions ? 'Yes' : 'No',
      'Style & Fitting Notes': c.styleNotes || '',
    }));

    const csvContent = objectsToCsv(headers, rows);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `customers-export-${dateStr}.csv`;

    return {
      filename,
      rowCount: rows.length,
      csv: csvContent,
    };
  }
}
