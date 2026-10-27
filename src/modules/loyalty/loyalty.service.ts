import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { UpdateLoyaltyRulesDto } from './dto/update-loyalty-rules.dto';
import { CouponQueryDto } from './dto/coupon-query.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ValidatePosCartDto } from './dto/validate-pos-cart.dto';
import { LoyaltyLedgerQueryDto } from './dto/loyalty-ledger-query.dto';
import { CreateReferralDto } from './dto/create-referral.dto';
import { paisaToRupees, rupeesToPaisa } from '@core/utils/currency-paisa.util';
import { objectsToCsv } from '@core/utils/csv-parser.util';
import {
  CouponType,
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
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  // ===========================================================================
  // Top Program Header Summary Strip Helper
  // ===========================================================================

  async getProgramSummary(storeId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      config,
      monthLedger,
      activeCustomers,
      couponsCount,
      ledgerCount,
    ] = await Promise.all([
      this.prisma.loyaltyConfig.findUnique({ where: { storeId } }),
      this.prisma.pointsLedger.findMany({
        where: {
          storeId,
          createdAt: { gte: startOfMonth },
        },
        select: { pointsChange: true, type: true },
      }),
      this.prisma.customer.findMany({
        where: { storeId, isActive: true },
        select: { loyaltyPoints: true },
      }),
      this.prisma.coupon.count({ where: { storeId } }),
      this.prisma.pointsLedger.count({ where: { storeId } }),
    ]);

    let monthPointsIssued = 0;
    let monthPointsRedeemed = 0;

    for (const entry of monthLedger) {
      if (entry.pointsChange > 0) {
        monthPointsIssued += entry.pointsChange;
      } else if (entry.pointsChange < 0) {
        monthPointsRedeemed += Math.abs(entry.pointsChange);
      }
    }

    const totalPointsOutstanding = activeCustomers.reduce(
      (sum, c) => sum + (c.loyaltyPoints || 0),
      0,
    );

    const pointValuePKR = config ? paisaToRupees(config.pointValue) : 1;
    const liabilityPKR = Math.round(totalPointsOutstanding * pointValuePKR);

    const subtitle = `This month: ${monthPointsIssued} pts issued · ${monthPointsRedeemed} redeemed · ${totalPointsOutstanding.toLocaleString('en-PK')} pts outstanding (Rs. ${liabilityPKR.toLocaleString('en-PK')} liability)`;

    return {
      monthPointsIssued,
      monthPointsRedeemed,
      totalPointsOutstanding,
      liabilityPKR,
      subtitle,
      tabCounts: {
        couponsCount,
        ledgerCount,
      },
      isActiveProgram: config?.isActive ?? true,
    };
  }

  // ===========================================================================
  // 1. Point Rules (Tab 1)
  // ===========================================================================

  async getRules(storeId: string) {
    let config = await this.prisma.loyaltyConfig.findUnique({
      where: { storeId },
    });

    if (!config) {
      config = await this.prisma.loyaltyConfig.create({
        data: { storeId },
      });
    }

    const rules = {
      isActive: config.isActive,
      spendPerPoint: paisaToRupees(config.spendPerPoint),
      pointValue: paisaToRupees(config.pointValue),
      minBillToRedeem: paisaToRupees(config.minBillToRedeem),
      minPointsToRedeem: config.minPointsToRedeem,
      maxPointsPerBill: config.maxPointsPerBill,
      maxBillPayablePct: config.maxBillPayablePct,
      pointsExpiryMonths: config.pointsExpiryMonths,
      silverTierThreshold: paisaToRupees(config.silverTierThreshold),
      goldTierThreshold: paisaToRupees(config.goldTierThreshold),
      reversePointsOnReturn: config.reversePointsOnReturn,
      referralBonusPoints: config.referralBonusPoints,
    };

    // Calculate dynamic worked example based on current active rules:
    // Sample scenario: Bill Rs. 2,000, customer has 500 pts
    const sampleBill = 2000;
    const customerPoints = 500;
    const maxPayableByPct = (sampleBill * rules.maxBillPayablePct) / 100;
    const maxPointsByBillCap = Math.floor(maxPayableByPct / (rules.pointValue || 1));

    let redeemablePoints = 0;
    if (sampleBill >= rules.minBillToRedeem && customerPoints >= rules.minPointsToRedeem) {
      redeemablePoints = Math.min(
        customerPoints,
        rules.maxPointsPerBill,
        maxPointsByBillCap,
      );
    }

    const discountPKR = Math.round(redeemablePoints * rules.pointValue);
    const netPayablePKR = Math.max(0, sampleBill - discountPKR);
    const pointsEarned = rules.spendPerPoint > 0 ? Math.floor(netPayablePKR / rules.spendPerPoint) : 0;

    const workedExample = {
      sampleBill,
      customerPoints,
      redeemablePoints,
      discountPKR,
      netPayablePKR,
      pointsEarned,
      text: `Bill Rs. ${sampleBill.toLocaleString('en-PK')} · customer has ${customerPoints} pts. Can redeem ${redeemablePoints} pts = -Rs. ${discountPKR.toLocaleString('en-PK')}. Pays Rs. ${netPayablePKR.toLocaleString('en-PK')}, earns ${pointsEarned} pts.`,
    };

    // Top 5 recent ledger activity
    const recentEntries = await this.prisma.pointsLedger.findMany({
      where: { storeId },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const recentLedger = recentEntries.map((p) => {
      let actionLabel: 'earn' | 'redeem' | 'referral' | 'adjustment' = 'adjustment';
      if (p.type === PointsTransactionType.EARNED) actionLabel = 'earn';
      else if (p.type === PointsTransactionType.REDEEMED) actionLabel = 'redeem';
      else if (p.type === PointsTransactionType.REFERRAL) actionLabel = 'referral';

      return {
        id: p.id,
        customerName: p.customer?.name || 'Customer',
        actionLabel,
        pointsDelta: p.pointsChange,
        pointsFormatted: p.pointsChange > 0 ? `+${p.pointsChange}` : `${p.pointsChange}`,
        dateFormatted: formatDate(p.createdAt),
      };
    });

    const summary = await this.getProgramSummary(storeId);

    return {
      summary,
      rules,
      workedExample,
      recentLedger,
    };
  }

  async updateRules(storeId: string, dto: UpdateLoyaltyRulesDto) {
    await this.prisma.loyaltyConfig.upsert({
      where: { storeId },
      update: {
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.spendPerPoint !== undefined ? { spendPerPoint: rupeesToPaisa(dto.spendPerPoint) } : {}),
        ...(dto.pointValue !== undefined ? { pointValue: rupeesToPaisa(dto.pointValue) } : {}),
        ...(dto.minBillToRedeem !== undefined ? { minBillToRedeem: rupeesToPaisa(dto.minBillToRedeem) } : {}),
        ...(dto.minPointsToRedeem !== undefined ? { minPointsToRedeem: dto.minPointsToRedeem } : {}),
        ...(dto.maxPointsPerBill !== undefined ? { maxPointsPerBill: dto.maxPointsPerBill } : {}),
        ...(dto.maxBillPayablePct !== undefined ? { maxBillPayablePct: dto.maxBillPayablePct } : {}),
        ...(dto.pointsExpiryMonths !== undefined ? { pointsExpiryMonths: dto.pointsExpiryMonths } : {}),
        ...(dto.silverTierThreshold !== undefined ? { silverTierThreshold: rupeesToPaisa(dto.silverTierThreshold) } : {}),
        ...(dto.goldTierThreshold !== undefined ? { goldTierThreshold: rupeesToPaisa(dto.goldTierThreshold) } : {}),
        ...(dto.reversePointsOnReturn !== undefined ? { reversePointsOnReturn: dto.reversePointsOnReturn } : {}),
        ...(dto.referralBonusPoints !== undefined ? { referralBonusPoints: dto.referralBonusPoints } : {}),
      },
      create: {
        storeId,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.spendPerPoint !== undefined ? { spendPerPoint: rupeesToPaisa(dto.spendPerPoint) } : {}),
        ...(dto.pointValue !== undefined ? { pointValue: rupeesToPaisa(dto.pointValue) } : {}),
        ...(dto.minBillToRedeem !== undefined ? { minBillToRedeem: rupeesToPaisa(dto.minBillToRedeem) } : {}),
        ...(dto.minPointsToRedeem !== undefined ? { minPointsToRedeem: dto.minPointsToRedeem } : {}),
        ...(dto.maxPointsPerBill !== undefined ? { maxPointsPerBill: dto.maxPointsPerBill } : {}),
        ...(dto.maxBillPayablePct !== undefined ? { maxBillPayablePct: dto.maxBillPayablePct } : {}),
        ...(dto.pointsExpiryMonths !== undefined ? { pointsExpiryMonths: dto.pointsExpiryMonths } : {}),
        ...(dto.silverTierThreshold !== undefined ? { silverTierThreshold: rupeesToPaisa(dto.silverTierThreshold) } : {}),
        ...(dto.goldTierThreshold !== undefined ? { goldTierThreshold: rupeesToPaisa(dto.goldTierThreshold) } : {}),
        ...(dto.reversePointsOnReturn !== undefined ? { reversePointsOnReturn: dto.reversePointsOnReturn } : {}),
        ...(dto.referralBonusPoints !== undefined ? { referralBonusPoints: dto.referralBonusPoints } : {}),
      },
    });

    return this.getRules(storeId);
  }

  // ===========================================================================
  // 2. Coupons (Tab 2)
  // ===========================================================================

  async listCoupons(storeId: string, query: CouponQueryDto) {
    const where: any = { storeId };

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { code: { contains: term, mode: 'insensitive' as const } },
        { title: { contains: term, mode: 'insensitive' as const } },
        { description: { contains: term, mode: 'insensitive' as const } },
      ];
    }

    const rawCoupons = await this.prisma.coupon.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const formatted = rawCoupons.map((c) => {
      const isExpired =
        !c.isActive ||
        (c.endsAt && c.endsAt < now) ||
        (c.totalUsesLimit > 0 && c.usedCount >= c.totalUsesLimit);

      const status: 'Live' | 'Expired' = isExpired ? 'Expired' : 'Live';

      return {
        id: c.id,
        code: c.code,
        type: c.type,
        title: c.title,
        description: c.description,
        discountPct: c.discountPct,
        discountAmount: paisaToRupees(c.discountAmount),
        maxDiscountAmount: paisaToRupees(c.maxDiscountAmount),
        minBillAmount: paisaToRupees(c.minBillAmount),
        usesPerCustomer: c.usesPerCustomer,
        totalUsesLimit: c.totalUsesLimit,
        validFromFormatted: formatDate(c.startsAt),
        startsAt: c.startsAt.toISOString(),
        endsAt: c.endsAt ? c.endsAt.toISOString() : null,
        status,
        usedCount: c.usedCount,
        discountGivenPKR: paisaToRupees(c.totalDiscountGiven),
        eligibleCategories: c.eligibleCategories,
        firstPurchaseOnly: c.firstPurchaseOnly,
        isActive: c.isActive,
      };
    });

    // Filter by status if requested
    let filtered = formatted;
    if (query.status && query.status !== 'ALL') {
      filtered = formatted.filter(
        (c) => c.status.toUpperCase() === query.status?.toUpperCase(),
      );
    }

    const total = filtered.length;
    const paginatedItems = filtered.slice(query.skip, query.skip + query.limit);
    const summary = await this.getProgramSummary(storeId);

    return {
      summary,
      items: paginatedItems,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  async createCoupon(storeId: string, dto: CreateCouponDto) {
    const code = dto.code.trim().toUpperCase();

    const existing = await this.prisma.coupon.findUnique({
      where: { storeId_code: { storeId, code } },
    });

    if (existing) {
      throw new ConflictException(`Coupon with code "${code}" already exists in your store`);
    }

    const created = await this.prisma.coupon.create({
      data: {
        storeId,
        code,
        type: dto.type || CouponType.PERCENTAGE,
        title: dto.title.trim(),
        description: dto.description.trim(),
        discountPct: dto.discountPct ?? null,
        discountAmount: rupeesToPaisa(dto.discountAmount || 0),
        maxDiscountAmount: rupeesToPaisa(dto.maxDiscountAmount || 0),
        minBillAmount: rupeesToPaisa(dto.minBillAmount || 0),
        usesPerCustomer: dto.usesPerCustomer ?? 1,
        totalUsesLimit: dto.totalUsesLimit ?? 0,
        startsAt: new Date(dto.startsAt),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        eligibleCategories: dto.eligibleCategories || [],
        firstPurchaseOnly: dto.firstPurchaseOnly ?? false,
        isActive: dto.isActive ?? true,
      },
    });

    return {
      ...created,
      discountAmount: paisaToRupees(created.discountAmount),
      maxDiscountAmount: paisaToRupees(created.maxDiscountAmount),
      minBillAmount: paisaToRupees(created.minBillAmount),
      totalDiscountGiven: paisaToRupees(created.totalDiscountGiven),
    };
  }

  async updateCoupon(storeId: string, id: string, dto: UpdateCouponDto) {
    const coupon = await this.prisma.coupon.findFirst({
      where: { id, storeId },
    });

    if (!coupon) {
      throw new NotFoundException(`Coupon with ID "${id}" not found`);
    }

    let code = undefined;
    if (dto.code && dto.code.trim().toUpperCase() !== coupon.code) {
      code = dto.code.trim().toUpperCase();
      const collision = await this.prisma.coupon.findUnique({
        where: { storeId_code: { storeId, code } },
      });
      if (collision) {
        throw new ConflictException(`Coupon with code "${code}" already exists`);
      }
    }

    const updated = await this.prisma.coupon.update({
      where: { id },
      data: {
        ...(code ? { code } : {}),
        ...(dto.type ? { type: dto.type } : {}),
        ...(dto.title ? { title: dto.title.trim() } : {}),
        ...(dto.description ? { description: dto.description.trim() } : {}),
        ...(dto.discountPct !== undefined ? { discountPct: dto.discountPct } : {}),
        ...(dto.discountAmount !== undefined ? { discountAmount: rupeesToPaisa(dto.discountAmount) } : {}),
        ...(dto.maxDiscountAmount !== undefined ? { maxDiscountAmount: rupeesToPaisa(dto.maxDiscountAmount) } : {}),
        ...(dto.minBillAmount !== undefined ? { minBillAmount: rupeesToPaisa(dto.minBillAmount) } : {}),
        ...(dto.usesPerCustomer !== undefined ? { usesPerCustomer: dto.usesPerCustomer } : {}),
        ...(dto.totalUsesLimit !== undefined ? { totalUsesLimit: dto.totalUsesLimit } : {}),
        ...(dto.startsAt ? { startsAt: new Date(dto.startsAt) } : {}),
        ...(dto.endsAt !== undefined ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null } : {}),
        ...(dto.eligibleCategories !== undefined ? { eligibleCategories: dto.eligibleCategories } : {}),
        ...(dto.firstPurchaseOnly !== undefined ? { firstPurchaseOnly: dto.firstPurchaseOnly } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    return {
      ...updated,
      discountAmount: paisaToRupees(updated.discountAmount),
      maxDiscountAmount: paisaToRupees(updated.maxDiscountAmount),
      minBillAmount: paisaToRupees(updated.minBillAmount),
      totalDiscountGiven: paisaToRupees(updated.totalDiscountGiven),
    };
  }

  // ===========================================================================
  // 3. Server-Side POS Cart Coupon & Points Validator
  // ===========================================================================

  async validatePosCart(storeId: string, dto: ValidatePosCartDto) {
    let couponValid = false;
    let couponDiscountPKR = 0;
    let couponMessage = '';
    let pointsRedeemed = 0;
    let pointsDiscountPKR = 0;
    let pointsMessage = '';

    const now = new Date();

    // 1. Coupon Validation
    if (dto.code && dto.code.trim()) {
      const code = dto.code.trim().toUpperCase();
      const coupon = await this.prisma.coupon.findUnique({
        where: { storeId_code: { storeId, code } },
      });

      if (!coupon || !coupon.isActive) {
        couponMessage = 'Coupon is invalid or inactive';
      } else if (coupon.startsAt > now) {
        couponMessage = 'Coupon is not yet active';
      } else if (coupon.endsAt && coupon.endsAt < now) {
        couponMessage = 'Coupon has expired';
      } else if (coupon.totalUsesLimit > 0 && coupon.usedCount >= coupon.totalUsesLimit) {
        couponMessage = 'Coupon total usage limit has been reached';
      } else if (dto.subtotal < paisaToRupees(coupon.minBillAmount)) {
        couponMessage = `Minimum bill of Rs. ${paisaToRupees(coupon.minBillAmount).toLocaleString('en-PK')} required`;
      } else {
        // First purchase only check
        let isFirstPurchaseViolation = false;
        if (coupon.firstPurchaseOnly && dto.customerId) {
          const completedOrders = await this.prisma.order.count({
            where: {
              storeId,
              customerId: dto.customerId,
              status: OrderStatus.COMPLETED,
            },
          });
          if (completedOrders > 0) {
            couponMessage = 'Coupon is only valid for customer first purchase';
            isFirstPurchaseViolation = true;
          }
        }

        if (!isFirstPurchaseViolation) {
          couponValid = true;

          // Compute eligible total based on categories
          let eligibleSubtotal = dto.subtotal;
          if (coupon.eligibleCategories && coupon.eligibleCategories.length > 0) {
            const categories = coupon.eligibleCategories.map((c) => c.toLowerCase());
            const matchingItems = dto.cartItems.filter(
              (item) => item.categoryName && categories.includes(item.categoryName.toLowerCase()),
            );
            eligibleSubtotal = matchingItems.reduce((sum, it) => sum + it.lineTotal, 0);
          }

          if (coupon.type === CouponType.PERCENTAGE) {
            const pct = coupon.discountPct || 0;
            let discount = (eligibleSubtotal * pct) / 100;
            const maxCap = paisaToRupees(coupon.maxDiscountAmount);
            if (maxCap > 0 && discount > maxCap) {
              discount = maxCap;
            }
            couponDiscountPKR = Math.round(discount);
          } else if (coupon.type === CouponType.FIXED_AMOUNT) {
            const fixedAmt = paisaToRupees(coupon.discountAmount);
            couponDiscountPKR = Math.min(dto.subtotal, Math.round(fixedAmt));
          } else if (coupon.type === CouponType.FREE_SHIPPING) {
            couponDiscountPKR = 0;
          }
        }
      }
    }

    // 2. Loyalty Points Validation
    const config = await this.prisma.loyaltyConfig.findUnique({
      where: { storeId },
    });

    const isProgramActive = config?.isActive ?? true;
    const minBillToRedeem = config ? paisaToRupees(config.minBillToRedeem) : 1000;
    const minPointsToRedeem = config?.minPointsToRedeem ?? 100;
    const maxPointsPerBill = config?.maxPointsPerBill ?? 1000;
    const maxBillPayablePct = config?.maxBillPayablePct ?? 20;
    const pointValue = config ? paisaToRupees(config.pointValue) : 1;
    const spendPerPoint = config ? paisaToRupees(config.spendPerPoint) : 100;

    const remainingSubtotal = Math.max(0, dto.subtotal - couponDiscountPKR);

    if (isProgramActive && dto.redeemPoints && dto.redeemPoints > 0 && dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, storeId },
      });

      if (!customer) {
        pointsMessage = 'Customer profile not found';
      } else if (dto.subtotal < minBillToRedeem) {
        pointsMessage = `Minimum bill of Rs. ${minBillToRedeem.toLocaleString('en-PK')} required to redeem points`;
      } else if (customer.loyaltyPoints < minPointsToRedeem) {
        pointsMessage = `Minimum ${minPointsToRedeem} points required to redeem`;
      } else {
        const maxPayableAmount = (remainingSubtotal * maxBillPayablePct) / 100;
        const maxPointsByBill = Math.floor(maxPayableAmount / (pointValue || 1));
        const allowablePoints = Math.min(
          customer.loyaltyPoints,
          dto.redeemPoints,
          maxPointsPerBill,
          maxPointsByBill,
        );

        if (allowablePoints >= minPointsToRedeem) {
          pointsRedeemed = allowablePoints;
          pointsDiscountPKR = Math.round(allowablePoints * pointValue);
        } else {
          pointsMessage = `Cannot redeem less than ${minPointsToRedeem} points or exceed ${maxBillPayablePct}% of bill`;
        }
      }
    }

    const netPayablePKR = Math.max(0, dto.subtotal - couponDiscountPKR - pointsDiscountPKR);
    const pointsToEarn =
      isProgramActive && spendPerPoint > 0 ? Math.floor(netPayablePKR / spendPerPoint) : 0;

    return {
      couponValid,
      couponDiscountPKR,
      couponMessage,
      pointsRedeemed,
      pointsDiscountPKR,
      pointsMessage,
      netPayablePKR,
      pointsToEarn,
    };
  }

  // ===========================================================================
  // 4. Referrals & Points Ledger (Tab 3)
  // ===========================================================================

  async listLedger(storeId: string, query: LoyaltyLedgerQueryDto) {
    const where: any = { storeId };

    if (query.type && query.type !== 'ALL') {
      const t = query.type.toUpperCase() as PointsTransactionType;
      if (Object.values(PointsTransactionType).includes(t)) {
        where.type = t;
      }
    }

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term, mode: 'insensitive' as const } },
        { description: { contains: term, mode: 'insensitive' as const } },
        { refereeName: { contains: term, mode: 'insensitive' as const } },
        { refereePhone: { contains: term, mode: 'insensitive' as const } },
        { customer: { name: { contains: term, mode: 'insensitive' as const } } },
        { customer: { phone: { contains: term, mode: 'insensitive' as const } } },
      ];
    }

    const [total, rawEntries] = await Promise.all([
      this.prisma.pointsLedger.count({ where }),
      this.prisma.pointsLedger.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
    ]);

    const items = rawEntries.map((p) => {
      let typeBadge: 'Earned' | 'Redeemed' | 'Referral' | 'Adjustment' = 'Adjustment';
      if (p.type === PointsTransactionType.EARNED) typeBadge = 'Earned';
      else if (p.type === PointsTransactionType.REDEEMED) typeBadge = 'Redeemed';
      else if (p.type === PointsTransactionType.REFERRAL) typeBadge = 'Referral';

      return {
        id: p.id,
        customer: {
          id: p.customer.id,
          name: p.customer.name,
          phone: p.customer.phone,
        },
        type: p.type,
        typeBadge,
        referenceTitle: p.title,
        referenceSubtitle: p.description || p.title,
        dateFormatted: formatDate(p.createdAt),
        pointsDelta: p.pointsChange,
        pointsFormatted: p.pointsChange > 0 ? `+${p.pointsChange} pts` : `${p.pointsChange} pts`,
        direction: (p.pointsChange >= 0 ? 'CREDIT' : 'DEBIT') as 'CREDIT' | 'DEBIT',
        status: 'Completed' as const,
      };
    });

    const summary = await this.getProgramSummary(storeId);

    return {
      summary,
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  async recordReferral(
    storeId: string,
    userId: string,
    dto: CreateReferralDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const referrer = await tx.customer.findFirst({
        where: { id: dto.referrerCustomerId, storeId },
      });

      if (!referrer) {
        throw new NotFoundException(`Referrer customer with ID "${dto.referrerCustomerId}" not found`);
      }

      const config = await tx.loyaltyConfig.findUnique({
        where: { storeId },
      });

      const bonusPoints = dto.bonusPoints || config?.referralBonusPoints || 300;
      const newBalance = referrer.loyaltyPoints + bonusPoints;

      await tx.customer.update({
        where: { id: referrer.id },
        data: { loyaltyPoints: newBalance },
      });

      const ledgerEntry = await tx.pointsLedger.create({
        data: {
          storeId,
          customerId: referrer.id,
          pointsChange: bonusPoints,
          type: PointsTransactionType.REFERRAL,
          title: `Referred friend: ${dto.refereeName.trim()}`,
          description: dto.refereePhone
            ? `Friend phone: ${dto.refereePhone.trim()}`
            : 'Referral reward',
          refereeName: dto.refereeName.trim(),
          refereePhone: dto.refereePhone?.trim() || null,
          createdById: userId,
        },
      });

      return {
        success: true,
        referrerId: referrer.id,
        referrerName: referrer.name,
        bonusAwarded: bonusPoints,
        newPointsBalance: newBalance,
        ledgerId: ledgerEntry.id,
      };
    });
  }

  async exportLedgerCsv(storeId: string) {
    const entries = await this.prisma.pointsLedger.findMany({
      where: { storeId },
      include: {
        customer: { select: { name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const headers = [
      'Transaction ID',
      'Customer Name',
      'Phone',
      'Type',
      'Reference / Details',
      'Date',
      'Points Delta',
      'Status',
    ];

    const rows = entries.map((e) => ({
      'Transaction ID': e.id,
      'Customer Name': e.customer?.name || 'Customer',
      Phone: e.customer?.phone || '',
      Type: e.type,
      'Reference / Details': e.description || e.title,
      Date: formatDate(e.createdAt),
      'Points Delta': e.pointsChange > 0 ? `+${e.pointsChange}` : `${e.pointsChange}`,
      Status: 'Completed',
    }));

    const csvContent = objectsToCsv(headers, rows);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `loyalty-ledger-${dateStr}.csv`;

    return {
      filename,
      rowCount: rows.length,
      csv: csvContent,
    };
  }
}
