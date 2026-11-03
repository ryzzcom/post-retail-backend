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
import { paisaToRupees, rupeesToPaisa } from '@core/utils/currency-paisa.util';
import { calculateDaysElapsedPkt } from '@core/utils/date-time.util';
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
} from '@prisma/client';

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesService: SalesService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Complete POS Checkout Pipeline
   * - Enforces Store Settings: allowNegativeInventory, requireCustomerPhoneOnSale, autoRoundToNearestRupee, enableKhataCreditAtPos, blockNewCreditWhenOverdue
   * - Enforces Product.minSellingPrice
   * - Checks and decrements stock with StockMovement (SALE)
   * - Increments Coupon usage & discount given
   * - Updates Customer lifetimeSpend, lastVisitAt, auto-upgrades Tier, awards Loyalty Points with PointsLedger
   * - Checks Customer creditLimit, increments currentKhataBalance, appends KhataLedger (DEBIT_PURCHASE)
   * - Increments CashierShift.expectedCash for Cash tenders
   * - Creates WhatsApp digital receipt log and marks Order.whatsappStatus if enabled
   * - Invalidates Redis dashboard cache
   * - Creates AuditLog entry
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

    // 1. Fetch store operational settings
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });

    // Check store policy: require customer phone
    if (store?.requireCustomerPhoneOnSale && !dto.customerId) {
      throw new BadRequestException(
        'Customer profile with phone number is required for all sales as per store settings',
      );
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

    const orderDiscountPaisa = dto.discount ? rupeesToPaisa(dto.discount) : 0n;
    let grandTotalPaisa = subtotalPaisa - orderDiscountPaisa;

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
          counterId: dto.counterId,
          shiftId: dto.shiftId,
          cashierId,
          customerId: dto.customerId,
          receiptNo,
          idempotencyKey,
          subtotal: subtotalPaisa,
          discount: orderDiscountPaisa,
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
              referenceNo: p.referenceNo,
            })),
          },
        },
        include: {
          items: true,
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
      if (dto.customerId) {
        customerRecord = await tx.customer.findFirst({
          where: { id: dto.customerId, storeId },
        });

        if (customerRecord) {
          const loyaltyConfig = await tx.loyaltyConfig.findUnique({
            where: { storeId },
          });

          let pointsEarned = 0;
          if (
            loyaltyConfig &&
            loyaltyConfig.isActive &&
            loyaltyConfig.spendPerPoint > 0
          ) {
            pointsEarned =
              loyaltyConfig.spendPerPoint > 0n
                ? Number(grandTotalPaisa / loyaltyConfig.spendPerPoint)
                : 0;
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

          await tx.customer.update({
            where: { id: customerRecord.id },
            data: {
              lifetimeSpend: newLifetimeSpend,
              loyaltyPoints: { increment: pointsEarned },
              lastVisitAt: new Date(),
              tier: newTier,
            },
          });
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

      return order;
    });
  }

  async holdBill(storeId: string, cashierId: string, dto: HoldBillDto) {
    return this.prisma.heldBill.create({
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
  }

  async listHeldBills(storeId: string) {
    return this.prisma.heldBill.findMany({
      where: {
        storeId,
        status: HeldBillStatus.HELD,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resumeHeldBill(storeId: string, id: string) {
    const heldBill = await this.prisma.heldBill.findFirst({
      where: { id, storeId, status: HeldBillStatus.HELD },
    });

    if (!heldBill) {
      throw new NotFoundException(`Held bill with ID ${id} not found or already resumed`);
    }

    return this.prisma.heldBill.update({
      where: { id: heldBill.id },
      data: { status: HeldBillStatus.RESUMED },
    });
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
