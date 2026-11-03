import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { SalesService } from '@modules/sales/sales.service';
import { RedisService } from '@core/redis/redis.service';
import { CheckoutDto } from './dto/checkout.dto';
import { HoldBillDto } from './dto/hold-bill.dto';
import { ReturnOrderDto } from './dto/return-order.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { PosProductQueryDto } from './dto/pos-product-query.dto';
import { PosCustomerQueryDto } from './dto/pos-customer-query.dto';
import { QuickCustomerDto } from './dto/quick-customer.dto';
import { paisaToRupees, rupeesToPaisa } from '@core/utils/currency-paisa.util';
import { calculateDaysElapsedPkt, formatPktTime } from '@core/utils/date-time.util';
import {
  CustomerTier,
  HeldBillStatus,
  KhataTransactionType,
  OrderStatus,
  PaymentMethod,
  PointsTransactionType,
  ShiftStatus,
  StockMovementType,
  WhatsappStatus,
  WhatsAppMessageCategory,
  Prisma,
} from '@prisma/client';

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesService: SalesService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 1. GET /api/v1/pos/products
   * Returns catalog products mapped into PosProduct[] with variant matrix & stock availability
   */
  async getPosProducts(storeId: string, query: PosProductQueryDto) {
    const where: Prisma.ProductWhereInput = {
      storeId,
      isActive: true,
      isArchived: false,
    };

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { styleCode: { contains: term, mode: 'insensitive' } },
        { barcode: { contains: term, mode: 'insensitive' } },
        {
          variants: {
            some: {
              OR: [
                { sku: { contains: term, mode: 'insensitive' } },
                { barcode: { contains: term, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    if (query.category && query.category.trim() && query.category.toLowerCase() !== 'all') {
      const cat = query.category.trim();
      where.OR = [
        ...(where.OR || []),
        { category: { name: { equals: cat, mode: 'insensitive' } } },
        { categoryId: cat },
        { subCategory: { equals: cat, mode: 'insensitive' } },
      ];
    }

    const products = await this.prisma.product.findMany({
      where,
      take: query.limit || 100,
      orderBy: { createdAt: 'desc' },
      include: {
        category: true,
        variants: {
          include: {
            inventory: { where: { storeId } },
          },
        },
      },
    });

    const mappedProducts = products.map((p) => {
      const variants = p.variants.map((v) => {
        const stock = v.inventory.reduce((sum, inv) => sum + inv.quantityOnHand, 0);
        return {
          id: v.id,
          sku: v.sku,
          barcode: v.barcode,
          color: v.color || 'Standard',
          size: v.size || 'One Size',
          stock,
          price: paisaToRupees(v.retailPrice),
        };
      });

      const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
      const colorNames = Array.from(
        new Set(variants.map((v) => v.color).filter(Boolean)),
      );
      const availableSizes = Array.from(
        new Set(variants.map((v) => v.size).filter(Boolean)),
      );
      const firstPrice = variants.length > 0 ? variants[0].price : 0;

      return {
        id: p.id,
        name: p.name,
        code: p.styleCode || p.barcode || (variants[0]?.sku ?? ''),
        category: p.category?.name || p.subCategory || 'General',
        fabric: p.brand || p.description || '',
        price: firstPrice,
        image: p.imageUrl || '',
        colorNames,
        colorSwatches: colorNames,
        availableSizes,
        variants,
        totalStock,
      };
    });

    if (query.inStockOnly) {
      return mappedProducts.filter((p) => p.totalStock > 0);
    }

    return mappedProducts;
  }

  /**
   * 2. GET /api/v1/pos/customers
   * Search customer profiles for POS customer bar
   */
  async getPosCustomers(storeId: string, query: PosCustomerQueryDto) {
    const where: Prisma.CustomerWhereInput = {
      storeId,
    };

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
      ];
    }

    const customers = await this.prisma.customer.findMany({
      where,
      take: query.limit || 20,
      orderBy: { lastVisitAt: 'desc' },
    });

    return customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone || '',
      email: c.email || '',
      tier: c.tier,
      pointsBalance: c.loyaltyPoints,
      khataBalance: paisaToRupees(c.currentKhataBalance),
      khataLimit: paisaToRupees(c.creditLimit),
    }));
  }

  /**
   * 3. POST /api/v1/pos/customers/quick
   * Quick customer registration from POS cart or Shift view
   */
  async quickCreateCustomer(storeId: string, dto: QuickCustomerDto) {
    const phone = dto.phoneNumber.trim();

    const existing = await this.prisma.customer.findFirst({
      where: { storeId, phone },
    });

    if (existing) {
      return {
        id: existing.id,
        name: existing.name,
        phone: existing.phone || '',
        email: existing.email || '',
        tier: existing.tier,
        pointsBalance: existing.loyaltyPoints,
        khataBalance: paisaToRupees(existing.currentKhataBalance),
        khataLimit: paisaToRupees(existing.creditLimit),
      };
    }

    const newCustomer = await this.prisma.customer.create({
      data: {
        storeId,
        name: dto.fullName.trim(),
        phone,
        email: dto.email?.trim() || null,
        styleNotes: dto.notes?.trim() || null,
        loyaltyPoints: 0,
        currentKhataBalance: 0n,
        creditLimit: 5000000n, // Rs. 50,000 standard credit limit
        tier: CustomerTier.REGULAR,
      },
    });

    return {
      id: newCustomer.id,
      name: newCustomer.name,
      phone: newCustomer.phone || '',
      email: newCustomer.email || '',
      tier: newCustomer.tier,
      pointsBalance: newCustomer.loyaltyPoints,
      khataBalance: 0,
      khataLimit: paisaToRupees(newCustomer.creditLimit),
    };
  }

  /**
   * 4. GET /api/v1/pos/counters
   * List counters for the current store
   */
  async getCounters(storeId: string) {
    let counters = await this.prisma.counter.findMany({
      where: { storeId, isActive: true },
      orderBy: { code: 'asc' },
    });

    if (counters.length === 0) {
      const defaultCounter = await this.prisma.counter.create({
        data: {
          storeId,
          code: '1',
          name: 'Counter 1',
          isActive: true,
        },
      });
      counters = [defaultCounter];
    }

    return counters.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      isActive: c.isActive,
    }));
  }

  /**
   * Complete POS Checkout Pipeline
   * - Enforces Store Settings: allowNegativeInventory, requireCustomerPhoneOnSale, autoRoundToNearestRupee, enableKhataCreditAtPos, blockNewCreditWhenOverdue
   * - Enforces Product.minSellingPrice
   * - Checks and decrements stock with StockMovement (SALE)
   * - Increments Coupon usage & discount given
   * - Updates Customer lifetimeSpend, lastVisitAt, auto-upgrades Tier, awards & redeems Loyalty Points
   * - Checks Customer creditLimit, increments currentKhataBalance, appends KhataLedger (DEBIT_PURCHASE)
   * - Increments CashierShift.expectedCash for Cash tenders
   * - Creates WhatsApp digital receipt log and marks Order.whatsappStatus if enabled
   * - Invalidates Redis dashboard cache
   * - Creates AuditLog entry
   * - Returns complete PosSaleResult response
   */
  async checkout(
    storeId: string,
    cashierId: string,
    idempotencyKey: string,
    dto: CheckoutDto,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Checkout requires at least one order item');
    }

    // 1. Fetch store operational settings & cashier user
    const [store, cashier] = await Promise.all([
      this.prisma.store.findUnique({ where: { id: storeId } }),
      this.prisma.user.findUnique({ where: { id: cashierId } }),
    ]);

    // Check store policy: require customer phone
    if (store?.requireCustomerPhoneOnSale && !dto.customerId) {
      throw new BadRequestException(
        'Customer profile with phone number is required for all sales as per store settings',
      );
    }

    // Validate Counter
    let counterId = dto.counterId || '1';
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
      }
    }

    // 2. Validate variants, floor prices, and stock availability
    const variantIds = dto.items.map((i) => i.variantId);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds }, storeId },
      include: {
        product: true,
        inventory: { where: { storeId } },
      },
    });

    const variantMap = new Map(variants.map((v) => [v.id, v]));

    for (const item of dto.items) {
      const variant = variantMap.get(item.variantId);
      if (!variant) {
        throw new BadRequestException(
          `Variant with ID ${item.variantId} not found in this store`,
        );
      }

      // Check minSellingPrice floor
      const unitPricePaisa = rupeesToPaisa(item.unitPrice);
      const discountPaisa = item.discount ? rupeesToPaisa(item.discount) : 0n;
      const netUnitPricePaisa = unitPricePaisa - (discountPaisa / BigInt(item.quantity));

      if (
        variant.product.minSellingPrice > 0n &&
        netUnitPricePaisa < variant.product.minSellingPrice
      ) {
        throw new BadRequestException(
          `Item "${variant.product.name}" (${variant.sku}) cannot be sold below floor price Rs. ${paisaToRupees(
            variant.product.minSellingPrice,
          )}`,
        );
      }

      // Check stock availability (respect allowNegativeInventory toggle)
      if (!store?.allowNegativeInventory) {
        const currentInv = variant.inventory?.[0];
        const currentStock = currentInv?.quantityOnHand ?? 0;
        if (currentStock < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for "${variant.product.name}" (${variant.sku}). Available: ${currentStock}, Requested: ${item.quantity}`,
          );
        }
      }
    }

    // Calculate subtotal, discounts, and grandTotal in integer minor units (paisas)
    let subtotalPaisa = 0n;
    const itemsData = dto.items.map((item) => {
      const unitPricePaisa = rupeesToPaisa(item.unitPrice);
      const discountPaisa = item.discount ? rupeesToPaisa(item.discount) : 0n;
      const itemSubtotal = unitPricePaisa * BigInt(item.quantity);
      const itemTotal = itemSubtotal - discountPaisa;

      subtotalPaisa += itemSubtotal;

      return {
        storeId,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: unitPricePaisa,
        subtotal: itemSubtotal,
        discount: discountPaisa,
        total: itemTotal,
      };
    });

    const totalDiscountRupees = (dto.discount || 0) + (dto.billDiscount || 0);
    const orderDiscountPaisa = rupeesToPaisa(totalDiscountRupees);
    const pointsRedeemedPaisa = dto.pointsRedeemed ? rupeesToPaisa(dto.pointsRedeemed) : 0n;

    let grandTotalPaisa = subtotalPaisa - orderDiscountPaisa - pointsRedeemedPaisa;
    if (grandTotalPaisa < 0n) grandTotalPaisa = 0n;

    // Apply auto-rounding to nearest Rupee if enabled in settings
    if (store?.autoRoundToNearestRupee) {
      const remainder = grandTotalPaisa % 100n;
      if (remainder >= 50n) {
        grandTotalPaisa = grandTotalPaisa + (100n - remainder);
      } else {
        grandTotalPaisa = grandTotalPaisa - remainder;
      }
    }

    // Generate unique receipt number
    const receiptNo = `REC-${Date.now().toString(36).toUpperCase()}-${Math.floor(
      1000 + Math.random() * 9000,
    )}`;

    return this.prisma.$transaction(async (tx) => {
      // 3. Create Order & Items & Payments
      const order = await tx.order.create({
        data: {
          storeId,
          counterId,
          shiftId: dto.shiftId,
          cashierId,
          customerId: dto.customerId,
          receiptNo,
          idempotencyKey,
          subtotal: subtotalPaisa,
          discount: orderDiscountPaisa + pointsRedeemedPaisa,
          grandTotal: grandTotalPaisa,
          status: OrderStatus.COMPLETED,
          notes: dto.notes,
          items: {
            create: itemsData,
          },
          payments: {
            create: dto.payments.map((p) => ({
              storeId,
              method: p.method,
              amount: rupeesToPaisa(p.amount),
              referenceNo: p.referenceNo || p.reference,
            })),
          },
        },
        include: {
          items: {
            include: {
              variant: {
                include: { product: true },
              },
            },
          },
          payments: true,
        },
      });

      // 4. Deduct inventory quantities and record StockMovement (SALE)
      for (const item of dto.items) {
        const variant = variantMap.get(item.variantId)!;
        const currentInv = variant.inventory?.[0];
        const previousQty = currentInv?.quantityOnHand ?? 0;
        const newQty = previousQty - item.quantity;

        await tx.storeInventory.updateMany({
          where: {
            storeId,
            variantId: item.variantId,
          },
          data: {
            quantityOnHand: {
              decrement: item.quantity,
            },
          },
        });

        await tx.stockMovement.create({
          data: {
            storeId,
            variantId: item.variantId,
            type: StockMovementType.SALE,
            quantity: item.quantity,
            previousQty,
            newQty,
            referenceNo: receiptNo,
            performedByUserId: cashierId,
            reason: `POS Checkout #${receiptNo}`,
          },
        });
      }

      // 5. Coupon Usage Tracking
      if (dto.couponCode) {
        const coupon = await tx.coupon.findFirst({
          where: { storeId, code: dto.couponCode.toUpperCase().trim() },
        });
        if (coupon) {
          await tx.coupon.update({
            where: { id: coupon.id },
            data: {
              usedCount: { increment: 1 },
              totalDiscountGiven: { increment: orderDiscountPaisa },
            },
          });
        }
      }

      // 6. Customer Spend, Loyalty Points & Auto Tier Upgrade
      let customerRecord = null;
      let pointsEarned = 0;
      if (dto.customerId) {
        customerRecord = await tx.customer.findFirst({
          where: { id: dto.customerId, storeId },
        });

        if (customerRecord) {
          // Points Redemption
          if (dto.pointsRedeemed && dto.pointsRedeemed > 0) {
            const redeemAmount = Math.min(dto.pointsRedeemed, customerRecord.loyaltyPoints);
            if (redeemAmount > 0) {
              await tx.pointsLedger.create({
                data: {
                  storeId,
                  customerId: customerRecord.id,
                  orderId: order.id,
                  pointsChange: -redeemAmount,
                  type: PointsTransactionType.REDEEMED,
                  title: `Redeemed on receipt #${receiptNo}`,
                  description: `POS sale #${receiptNo}`,
                },
              });
              await tx.customer.update({
                where: { id: customerRecord.id },
                data: { loyaltyPoints: { decrement: redeemAmount } },
              });
              customerRecord.loyaltyPoints -= redeemAmount;
            }
          }

          // Points Earning
          const loyaltyConfig = await tx.loyaltyConfig.findUnique({
            where: { storeId },
          });

          if (loyaltyConfig && loyaltyConfig.isActive && loyaltyConfig.spendPerPoint > 0) {
            pointsEarned = Number(grandTotalPaisa / loyaltyConfig.spendPerPoint);
          } else {
            // Default 1 point per 100 PKR spent
            pointsEarned = Math.floor(paisaToRupees(grandTotalPaisa) / 100);
          }

          if (pointsEarned > 0) {
            await tx.pointsLedger.create({
              data: {
                storeId,
                customerId: customerRecord.id,
                orderId: order.id,
                pointsChange: pointsEarned,
                type: PointsTransactionType.EARNED,
                title: `Earned on receipt #${receiptNo}`,
                description: `POS sale #${receiptNo}`,
              },
            });
          }

          const newLifetimeSpend = customerRecord.lifetimeSpend + grandTotalPaisa;
          let newTier = customerRecord.tier;
          if (loyaltyConfig) {
            if (newLifetimeSpend >= loyaltyConfig.goldTierThreshold) {
              newTier = CustomerTier.GOLD;
            } else if (
              newLifetimeSpend >= loyaltyConfig.silverTierThreshold &&
              newTier !== CustomerTier.GOLD
            ) {
              newTier = CustomerTier.SILVER;
            }
          }

          const updatedCustomer = await tx.customer.update({
            where: { id: customerRecord.id },
            data: {
              lifetimeSpend: newLifetimeSpend,
              loyaltyPoints: { increment: pointsEarned },
              lastVisitAt: new Date(),
              tier: newTier,
            },
          });
          customerRecord = updatedCustomer;
        }
      }

      // 7. Khata Payment Handling & Ledger
      const khataPayments = dto.payments.filter(
        (p) => p.method === PaymentMethod.KHATA,
      );
      if (khataPayments.length > 0) {
        if (!store?.enableKhataCreditAtPos) {
          throw new BadRequestException(
            'Khata credit is currently disabled at POS for this store in settings',
          );
        }

        if (!dto.customerId) {
          throw new BadRequestException(
            'Customer profile is mandatory for Khata (credit) payment',
          );
        }

        const customer = customerRecord || (await tx.customer.findFirst({
          where: { id: dto.customerId, storeId },
        }));

        if (!customer) {
          throw new BadRequestException(`Customer ${dto.customerId} not found`);
        }

        // Check if store blocks new credit when customer has overdue balance
        if (store?.blockNewCreditWhenOverdue && customer.currentKhataBalance > 0n) {
          const termsDays = store.defaultPaymentDueDays || 30;
          const oldestDebit = await tx.khataLedger.findFirst({
            where: {
              storeId,
              customerId: customer.id,
              type: KhataTransactionType.DEBIT_PURCHASE,
            },
            orderBy: { createdAt: 'asc' },
          });

          if (oldestDebit) {
            const daysOver = calculateDaysElapsedPkt(oldestDebit.createdAt);
            if (daysOver > termsDays) {
              throw new BadRequestException(
                `Khata credit blocked: Customer has an overdue balance past ${termsDays} days terms`,
              );
            }
          }
        }

        const totalKhataPaisa = khataPayments.reduce(
          (acc, p) => acc + rupeesToPaisa(p.amount),
          0n,
        );

        const newKhataBalance = customer.currentKhataBalance + totalKhataPaisa;
        if (newKhataBalance > customer.creditLimit) {
          throw new BadRequestException(
            `Customer credit limit exceeded! Available credit: Rs. ${paisaToRupees(
              customer.creditLimit - customer.currentKhataBalance,
            )}, Requested Khata: Rs. ${paisaToRupees(totalKhataPaisa)}`,
          );
        }

        await tx.customer.update({
          where: { id: customer.id },
          data: { currentKhataBalance: newKhataBalance },
        });

        await tx.khataLedger.create({
          data: {
            storeId,
            customerId: customer.id,
            orderId: order.id,
            type: KhataTransactionType.DEBIT_PURCHASE,
            amount: totalKhataPaisa,
            runningBalance: newKhataBalance,
            referenceNo: receiptNo,
            notes: `POS Purchase receipt #${receiptNo}`,
          },
        });
      }

      // 8. Cash Drawer Shift Expected Cash Handling
      const cashPayments = dto.payments.filter(
        (p) => p.method === PaymentMethod.CASH,
      );
      if (cashPayments.length > 0) {
        const totalCashPaisa = cashPayments.reduce(
          (acc, p) => acc + rupeesToPaisa(p.amount),
          0n,
        );

        let shift = null;
        if (dto.shiftId) {
          shift = await tx.cashierShift.findFirst({
            where: { id: dto.shiftId, storeId, status: ShiftStatus.OPEN },
          });
        } else {
          shift = await tx.cashierShift.findFirst({
            where: { cashierId, storeId, status: ShiftStatus.OPEN },
            orderBy: { openedAt: 'desc' },
          });
        }

        if (shift) {
          await tx.cashierShift.update({
            where: { id: shift.id },
            data: {
              expectedCash: { increment: totalCashPaisa },
            },
          });
        }
      }

      // 9. Digital WhatsApp Receipt Automation
      if (customerRecord && customerRecord.phone && customerRecord.whatsappReceiptsOptIn) {
        await tx.whatsAppMessageLog.create({
          data: {
            storeId,
            customerId: customerRecord.id,
            customerName: customerRecord.name,
            customerPhone: customerRecord.phone,
            receiptRef: receiptNo,
            templateName: 'Digital Receipt',
            message: `Thank you for shopping at ${store?.name || 'Retail POS'}! Receipt #${receiptNo} Total: Rs. ${paisaToRupees(grandTotalPaisa)}.`,
            status: WhatsappStatus.DELIVERED,
            category: WhatsAppMessageCategory.DIGITAL_RECEIPT,
          },
        });

        await tx.order.update({
          where: { id: order.id },
          data: {
            whatsappStatus: WhatsappStatus.DELIVERED,
          },
        });
      }

      // 10. Audit Log Entry
      await tx.auditLog.create({
        data: {
          storeId,
          userId: cashierId,
          action: 'ORDER_CREATED',
          entity: 'Order',
          entityId: order.id,
          details: {
            receiptNo,
            itemsCount: dto.items.length,
            grandTotal: paisaToRupees(grandTotalPaisa),
            paymentMethods: dto.payments.map((p) => p.method),
          },
        },
      });

      // 11. Invalidate Redis dashboard cache for immediate real-time reporting
      await this.redisService.delPattern(`dashboard:${storeId}:*`);

      // 12. Build enriched PosSaleResult compatible payload
      const cashierDisplayName =
        cashier?.fullName ||
        `${cashier?.firstName ?? ''} ${cashier?.lastName ?? ''}`.trim() ||
        'Cashier';

      const changeDuePKR = dto.payments.reduce(
        (acc, p) => acc + (p.changeDue || 0),
        0,
      );

      return {
        ...order,
        id: order.id,
        receiptNumber: order.receiptNo,
        receiptNo: order.receiptNo,
        completedAt: formatPktTime(order.createdAt),
        createdAt: order.createdAt.toISOString(),
        customer: customerRecord
          ? {
              id: customerRecord.id,
              name: customerRecord.name,
              phone: customerRecord.phone || '',
              email: customerRecord.email || '',
              tier: customerRecord.tier,
              pointsBalance: customerRecord.loyaltyPoints,
              khataBalance: paisaToRupees(customerRecord.currentKhataBalance),
              khataLimit: paisaToRupees(customerRecord.creditLimit),
            }
          : null,
        items: order.items.map((i) => ({
          id: i.id,
          productId: i.variant?.productId || '',
          productName: i.variant?.product?.name || 'Item',
          code: i.variant?.sku || '',
          variantId: i.variantId,
          sku: i.variant?.sku || '',
          size: i.variant?.size || 'One Size',
          color: i.variant?.color || 'Standard',
          unitPrice: paisaToRupees(i.unitPrice),
          quantity: i.quantity,
          discountType: 'fixed',
          discountValue: paisaToRupees(i.discount),
          lineTotal: paisaToRupees(i.total),
        })),
        subtotal: paisaToRupees(subtotalPaisa),
        pointsRedeemed: dto.pointsRedeemed || 0,
        pointsDiscountPKR: dto.pointsRedeemed || 0,
        billDiscountPKR: totalDiscountRupees,
        grandTotalPKR: paisaToRupees(grandTotalPaisa),
        tenders: dto.payments.map((p, idx) => ({
          id: `tender-${idx + 1}`,
          method: p.method.toLowerCase(),
          amount: p.amount,
          cashTendered: p.cashTendered || p.amount,
          changeDue: p.changeDue || 0,
          reference: p.referenceNo || p.reference,
        })),
        changeDuePKR,
        pointsEarned,
        newPointsBalance: customerRecord ? customerRecord.loyaltyPoints : 0,
        cashierName: cashierDisplayName,
        counterId,
        whatsappStatus: order.whatsappStatus.toLowerCase(),
      };
    });
  }

  async holdBill(storeId: string, cashierId: string, dto: HoldBillDto) {
    const held = await this.prisma.heldBill.create({
      data: {
        storeId,
        counterId: dto.counterId,
        cashierId,
        customerId: dto.customerId,
        referenceNote: dto.referenceNote,
        billData: dto.billData,
        status: HeldBillStatus.HELD,
      },
    });

    const data = typeof held.billData === 'object' && held.billData !== null ? (held.billData as any) : {};

    return {
      id: held.id,
      storeId: held.storeId,
      counterId: held.counterId,
      cashierId: held.cashierId,
      heldAt: formatPktTime(held.createdAt),
      createdAt: held.createdAt.toISOString(),
      customer: data.customer || null,
      items: data.items || [],
      subtotal: data.subtotal || 0,
      total: data.total || 0,
      note: held.referenceNote || data.note || '',
      referenceNote: held.referenceNote,
      billData: held.billData,
      status: held.status,
    };
  }

  async listHeldBills(storeId: string) {
    const heldBills = await this.prisma.heldBill.findMany({
      where: {
        storeId,
        status: HeldBillStatus.HELD,
      },
      orderBy: { createdAt: 'desc' },
    });

    return heldBills.map((h) => {
      const data = typeof h.billData === 'object' && h.billData !== null ? (h.billData as any) : {};
      return {
        id: h.id,
        storeId: h.storeId,
        counterId: h.counterId,
        cashierId: h.cashierId,
        heldAt: formatPktTime(h.createdAt),
        createdAt: h.createdAt.toISOString(),
        customer: data.customer || null,
        items: data.items || [],
        subtotal: data.subtotal || 0,
        total: data.total || 0,
        note: h.referenceNote || data.note || '',
        referenceNote: h.referenceNote,
        billData: h.billData,
        status: h.status,
      };
    });
  }

  async resumeHeldBill(storeId: string, id: string) {
    const heldBill = await this.prisma.heldBill.findFirst({
      where: { id, storeId, status: HeldBillStatus.HELD },
    });

    if (!heldBill) {
      throw new NotFoundException(`Held bill with ID ${id} not found or already resumed`);
    }

    const updated = await this.prisma.heldBill.update({
      where: { id: heldBill.id },
      data: { status: HeldBillStatus.RESUMED },
    });

    const data = typeof updated.billData === 'object' && updated.billData !== null ? (updated.billData as any) : {};

    return {
      id: updated.id,
      storeId: updated.storeId,
      counterId: updated.counterId,
      cashierId: updated.cashierId,
      heldAt: formatPktTime(updated.createdAt),
      customer: data.customer || null,
      items: data.items || [],
      subtotal: data.subtotal || 0,
      total: data.total || 0,
      note: updated.referenceNote || data.note || '',
      status: updated.status,
    };
  }

  async deleteHeldBill(storeId: string, id: string) {
    const heldBill = await this.prisma.heldBill.findFirst({
      where: { id, storeId },
    });

    if (!heldBill) {
      throw new NotFoundException(`Held bill with ID ${id} not found`);
    }

    await this.prisma.heldBill.update({
      where: { id: heldBill.id },
      data: { status: HeldBillStatus.VOIDED },
    });

    return {
      success: true,
      message: 'Held bill removed successfully',
      id: heldBill.id,
    };
  }

  /**
   * Consolidate POS return through SalesService for complete stock,
   * financial settlement, audit log & loyalty points reversal handling.
   */
  async returnOrder(storeId: string, cashierId: string, dto: ReturnOrderDto) {
    const originalOrder = await this.prisma.order.findFirst({
      where: { id: dto.originalOrderId, storeId },
      include: { items: true },
    });

    if (!originalOrder) {
      throw new NotFoundException(`Order ${dto.originalOrderId} not found`);
    }

    const saleReturnItems = dto.items.map((item) => {
      const orderItem = originalOrder.items.find((i) => i.id === item.orderItemId);
      if (!orderItem) {
        throw new BadRequestException(
          `Order item ${item.orderItemId} does not belong to order ${dto.originalOrderId}`,
        );
      }
      return {
        orderItemId: item.orderItemId,
        variantId: orderItem.variantId,
        quantity: item.quantity,
        condition: 'RESELLABLE' as const,
      };
    });

    return this.salesService.processSaleReturn(
      storeId,
      originalOrder.receiptNo,
      cashierId,
      {
        items: saleReturnItems,
        reason: dto.reason,
        settlementMethod: 'CASH',
      },
    );
  }

  async getOrderById(storeId: string, orderId: string) {
    return this.salesService.getReceiptDetail(storeId, orderId);
  }

  async listOrders(storeId: string, query: PaginationQueryDto) {
    return this.salesService.getSalesHistory(storeId, query as any);
  }
}
