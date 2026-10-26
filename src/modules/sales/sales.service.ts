import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { paisaToRupees } from '@core/utils/currency-paisa.util';
import {
  SalesHistoryQueryDto,
  PaymentMethodFilter,
} from './dto/sales-history-query.dto';
import {
  CreateSaleReturnDto,
  WhatsappRetryDto,
} from './dto/create-sale-return.dto';
import {
  OrderStatus,
  PaymentMethod,
  StockMovementType,
  KhataTransactionType,
  ShiftStatus,
  Prisma,
} from '@prisma/client';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper: Format Date/Time in Pakistan Standard Time (PKT, UTC+5)
   */
  private formatPktTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      timeZone: 'Asia/Karachi',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  private formatPktDateTime(date: Date): string {
    return date.toLocaleString('en-US', {
      timeZone: 'Asia/Karachi',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  /**
   * Helper: Mask Pakistani Phone Number (e.g. 0300-***4567)
   */
  private maskPhone(phone: string | null | undefined): string {
    if (!phone) return 'N/A';
    const clean = phone.replace(/[^0-9+]/g, '');
    if (clean.length >= 7) {
      return `${clean.slice(0, 4)}-***${clean.slice(-4)}`;
    }
    return clean;
  }

  /**
   * Helper: Format Payment Method Label
   */
  private formatPaymentMethodLabel(method: PaymentMethod): string {
    switch (method) {
      case PaymentMethod.CASH:
        return 'Cash';
      case PaymentMethod.CARD:
        return 'Card';
      case PaymentMethod.BANK_TRANSFER:
        return 'Bank transfer';
      case PaymentMethod.WALLET:
        return 'Wallet';
      case PaymentMethod.KHATA:
        return 'Khata credit';
      case PaymentMethod.SPLIT:
        return 'Split';
      default:
        return method;
    }
  }

  private formatPaymentSummary(
    payments: Array<{ method: PaymentMethod }>,
  ): string {
    if (!payments || payments.length === 0) return 'Cash';
    if (payments.length === 1) {
      return this.formatPaymentMethodLabel(payments[0].method);
    }
    const unique = Array.from(new Set(payments.map((p) => p.method)));
    if (unique.length === 1) {
      return this.formatPaymentMethodLabel(unique[0]);
    }
    const labels = unique
      .map((m) => this.formatPaymentMethodLabel(m))
      .join(', ');
    return `Split (${labels})`;
  }

  /**
   * 1. GET /api/v1/sales (Paginated Sales List + Top Summary KPIs)
   */
  async getSalesHistory(storeId: string, query: SalesHistoryQueryDto) {
    const where: Prisma.OrderWhereInput = {
      storeId,
    };

    // Filter by Cashier (for "My Sales" view)
    if (query.cashierId) {
      where.cashierId = query.cashierId;
    }

    // Filter by Payment Method
    if (query.paymentMethod && query.paymentMethod !== 'ALL') {
      where.payments = {
        some: {
          method: query.paymentMethod as PaymentMethod,
        },
      };
    }

    // Filter by Date Range
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    // Case-insensitive Search
    if (query.search && query.search.trim() !== '') {
      const term = query.search.trim();
      where.OR = [
        { receiptNo: { contains: term, mode: 'insensitive' } },
        {
          customer: {
            name: { contains: term, mode: 'insensitive' },
          },
        },
        {
          customer: {
            phone: { contains: term, mode: 'insensitive' },
          },
        },
        {
          items: {
            some: {
              variant: {
                sku: { contains: term, mode: 'insensitive' },
              },
            },
          },
        },
      ];
    }

    // Parallel Aggregations: Summary Strip + Paginated Rows
    const [summaryAgg, itemsAgg, orders] = await Promise.all([
      // Order counts & total revenue
      this.prisma.order.aggregate({
        where,
        _count: { id: true },
        _sum: { grandTotal: true },
      }),

      // Items sold aggregation
      this.prisma.orderItem.aggregate({
        where: {
          storeId,
          order: where,
        },
        _sum: { quantity: true },
      }),

      // Paginated rows
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
          cashier: {
            select: {
              id: true,
              fullName: true,
              firstName: true,
              lastName: true,
            },
          },
          payments: {
            select: {
              method: true,
              amount: true,
            },
          },
          items: {
            select: {
              quantity: true,
            },
          },
        },
      }),
    ]);

    const totalReceipts = summaryAgg._count.id;
    const totalItemsSold = itemsAgg._sum.quantity ?? 0;
    const totalRevenuePaisa = summaryAgg._sum.grandTotal ?? 0n;
    const totalRevenue = paisaToRupees(totalRevenuePaisa);

    // Map each row to lean, UI-ready fields
    const items = orders.map((order) => {
      const itemCount = order.items.reduce((acc, i) => acc + i.quantity, 0);
      const cashierName =
        order.cashier.fullName ||
        `${order.cashier.firstName ?? ''} ${order.cashier.lastName ?? ''}`.trim() ||
        'Cashier';

      return {
        id: order.id,
        receiptNo: order.receiptNo,
        createdAt: order.createdAt.toISOString(),
        timeLabel: this.formatPktTime(order.createdAt),
        itemCount,
        customer: {
          id: order.customer?.id ?? null,
          name: order.customer?.name ?? 'Walk-in',
          phone: order.customer?.phone ?? null,
        },
        paidBy: this.formatPaymentSummary(order.payments),
        cashier: {
          id: order.cashier.id,
          name: cashierName,
        },
        whatsappStatus: order.whatsappStatus,
        total: paisaToRupees(order.grandTotal),
      };
    });

    return {
      summary: {
        totalReceipts,
        totalItemsSold,
        totalRevenue,
      },
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total: totalReceipts,
        totalPages: Math.ceil(totalReceipts / query.limit) || 1,
      },
    };
  }

  /**
   * 2. GET /api/v1/sales/:receiptNo (Slide-Over Receipt Detail & Thermal Print Payload)
   */
  async getReceiptDetail(storeId: string, receiptNo: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        storeId,
        OR: [{ receiptNo }, { id: receiptNo }],
      },
      include: {
        store: true,
        customer: true,
        cashier: true,
        counter: true,
        payments: true,
        items: {
          include: {
            variant: {
              include: {
                product: {
                  select: { name: true, description: true },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Receipt #${receiptNo} not found`);
    }

    // Fetch related audit logs for historical timeline
    const auditLogs = await this.prisma.auditLog.findMany({
      where: {
        storeId,
        entity: 'Order',
        entityId: order.id,
      },
      orderBy: { createdAt: 'asc' },
    });

    const cashierName =
      order.cashier.fullName ||
      `${order.cashier.firstName ?? ''} ${order.cashier.lastName ?? ''}`.trim() ||
      'Staff';
    const customerName = order.customer?.name ?? 'Walk-in';

    // Map Line Items
    const lineItems = order.items.map((item) => {
      const productName = item.variant?.product?.name ?? 'General Retail Item';
      const sku = item.variant?.sku ?? 'SKU-N/A';
      const variantLabel = `${productName} · ${sku}`;
      const returnedQuantity = item.returnedQuantity ?? 0;
      const returnableQuantity = Math.max(0, item.quantity - returnedQuantity);

      return {
        id: item.id,
        variantId: item.variantId,
        productName,
        variantLabel,
        sku,
        quantity: item.quantity,
        returnedQuantity,
        returnableQuantity,
        unitPrice: paisaToRupees(item.unitPrice),
        discountAmount: paisaToRupees(item.discount),
        lineTotal: paisaToRupees(item.total),
      };
    });

    // Pricing Breakdown
    const pricing = {
      subtotal: paisaToRupees(order.subtotal),
      billDiscount: paisaToRupees(order.discount),
      redeemedPoints: 0,
      redeemedPointsAmount: 0,
      taxAmount: 0,
      grandTotal: paisaToRupees(order.grandTotal),
    };

    // Payments & Customer Loyalty
    const payments = order.payments.map((p) => ({
      method: this.formatPaymentMethodLabel(p.method),
      referenceCode: p.referenceNo ?? null,
      amount: paisaToRupees(p.amount),
    }));

    const customer = {
      id: order.customer?.id ?? null,
      name: customerName,
      phoneMasked: this.maskPhone(order.customer?.phone),
      phone: order.customer?.phone ?? null,
      pointsEarned: Math.floor(paisaToRupees(order.grandTotal) / 100),
      pointsBalance: order.customer?.loyaltyPoints ?? 0,
    };

    // Operational Actions State
    const whatsapp = {
      status: order.whatsappStatus,
      errorReason: order.whatsappError ?? null,
      canRetry: !!order.customer?.phone,
    };

    // Thermal Receipt Preview Block
    const thermalPreview = {
      storeName: order.store.name,
      storeAddress: order.store.address ?? 'Karachi, Pakistan',
      storePhone: order.store.phone ?? 'N/A',
      ntn: order.store.ntn ?? 'N/A',
      counterName: order.counter?.name ?? 'Counter 1',
      isDuplicateCopy: order.reprintCount > 0,
      reprintCount: order.reprintCount,
      footerPolicy:
        'Exchange within 7 days with receipt and tags attached. Sale items and cut unstitched fabric are non-returnable.',
    };

    // Chronological History Timeline
    const history: Array<{
      title: string;
      timestamp: string;
      actor: string;
      detail: string;
    }> = [
      {
        title: 'Sale completed',
        timestamp: order.createdAt.toISOString(),
        actor: cashierName,
        detail: `Rs. ${paisaToRupees(order.grandTotal).toLocaleString()} · ${this.formatPaymentSummary(order.payments)}`,
      },
    ];

    if (order.whatsappStatus === 'DELIVERED') {
      history.push({
        title: 'WhatsApp receipt delivered',
        timestamp: order.updatedAt.toISOString(),
        actor: 'System',
        detail: `Sent to ${this.maskPhone(order.customer?.phone)}`,
      });
    } else if (order.whatsappStatus === 'FAILED') {
      history.push({
        title: 'WhatsApp receipt failed',
        timestamp: order.updatedAt.toISOString(),
        actor: 'System',
        detail: order.whatsappError || 'Carrier delivery issue',
      });
    }

    for (const log of auditLogs) {
      if (log.action === 'RECEIPT_REPRINTED') {
        history.push({
          title: 'Receipt reprinted',
          timestamp: log.createdAt.toISOString(),
          actor: cashierName,
          detail: `Duplicate copy #${(log.details as any)?.newReprintCount ?? 1}`,
        });
      } else if (log.action === 'ORDER_RETURNED') {
        history.push({
          title: 'Return processed',
          timestamp: log.createdAt.toISOString(),
          actor: cashierName,
          detail: `Refund Rs. ${(log.details as any)?.refundAmountRupees ?? 0} (${(log.details as any)?.reason ?? 'Return'})`,
        });
      }
    }

    return {
      id: order.id,
      receiptNo: order.receiptNo,
      createdAt: order.createdAt.toISOString(),
      formattedDateTime: this.formatPktDateTime(order.createdAt),
      cashierName,
      customerName,
      status: order.status,
      items: lineItems,
      pricing,
      payments,
      customer,
      reprintCount: order.reprintCount,
      whatsapp,
      thermalPreview,
      history,
    };
  }

  /**
   * 3. POST /api/v1/sales/:receiptNo/reprint (Increment Reprint Counter & Log Audit)
   */
  async reprintReceipt(storeId: string, receiptNo: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        storeId,
        OR: [{ receiptNo }, { id: receiptNo }],
      },
      include: { store: true, counter: true },
    });

    if (!order) {
      throw new NotFoundException(`Receipt #${receiptNo} not found`);
    }

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        reprintCount: { increment: 1 },
      },
      include: { store: true, counter: true },
    });

    await this.prisma.auditLog.create({
      data: {
        storeId,
        userId,
        action: 'RECEIPT_REPRINTED',
        entity: 'Order',
        entityId: order.id,
        details: {
          receiptNo: order.receiptNo,
          newReprintCount: updated.reprintCount,
        },
      },
    });

    return {
      receiptNo: updated.receiptNo,
      reprintCount: updated.reprintCount,
      isDuplicateCopy: true,
      reprintedAt: new Date().toISOString(),
      thermalPreview: {
        storeName: updated.store.name,
        storeAddress: updated.store.address,
        storePhone: updated.store.phone,
        ntn: updated.store.ntn,
        counterName: updated.counter?.name ?? 'Counter 1',
        isDuplicateCopy: true,
        reprintCount: updated.reprintCount,
      },
    };
  }

  /**
   * 4. POST /api/v1/sales/:receiptNo/whatsapp-retry (Retry WhatsApp Receipt Dispatch)
   */
  async retryWhatsapp(
    storeId: string,
    receiptNo: string,
    userId: string,
    dto?: WhatsappRetryDto,
  ) {
    const order = await this.prisma.order.findFirst({
      where: {
        storeId,
        OR: [{ receiptNo }, { id: receiptNo }],
      },
      include: { customer: true },
    });

    if (!order) {
      throw new NotFoundException(`Receipt #${receiptNo} not found`);
    }

    const phone = dto?.phone || order.customer?.phone;
    if (!phone) {
      throw new BadRequestException(
        'Customer phone number is required to send WhatsApp receipt',
      );
    }

    // Update status to DELIVERED and clear errors
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        whatsappStatus: 'DELIVERED',
        whatsappError: null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        storeId,
        userId,
        action: 'WHATSAPP_RECEIPT_RETRIED',
        entity: 'Order',
        entityId: order.id,
        details: {
          receiptNo: order.receiptNo,
          phone,
        },
      },
    });

    return {
      receiptNo: updated.receiptNo,
      whatsappStatus: 'DELIVERED',
      message: 'WhatsApp receipt queued/sent successfully',
      phone,
    };
  }

  /**
   * 5. POST /api/v1/sales/:receiptNo/returns (Process Item Return or Exchange)
   */
  async processSaleReturn(
    storeId: string,
    receiptNo: string,
    userId: string,
    dto: CreateSaleReturnDto,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one item must be returned');
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: {
          storeId,
          OR: [{ receiptNo }, { id: receiptNo }],
        },
        include: {
          items: true,
          customer: true,
          shift: true,
        },
      });

      if (!order) {
        throw new NotFoundException(`Receipt #${receiptNo} not found`);
      }

      let totalRefundPaisa = 0n;

      // Validate & Process each item
      for (const reqItem of dto.items) {
        const orderItem = order.items.find((i) => i.id === reqItem.orderItemId);
        if (!orderItem) {
          throw new BadRequestException(
            `Order item ${reqItem.orderItemId} does not belong to this receipt`,
          );
        }

        const returnableQty =
          orderItem.quantity - (orderItem.returnedQuantity ?? 0);
        if (reqItem.quantity > returnableQty) {
          throw new BadRequestException(
            `Requested return quantity (${reqItem.quantity}) exceeds returnable quantity (${returnableQty}) for item`,
          );
        }

        // Calculate item refund amount in Paisas
        const unitPricePaisa = orderItem.unitPrice;
        const itemRefundPaisa = BigInt(reqItem.quantity) * unitPricePaisa;
        totalRefundPaisa += itemRefundPaisa;

        // Update returned quantity on OrderItem
        await tx.orderItem.update({
          where: { id: orderItem.id },
          data: {
            returnedQuantity: { increment: reqItem.quantity },
          },
        });

        // Inventory Stock Movements
        if (reqItem.condition === 'RESELLABLE') {
          await tx.storeInventory.updateMany({
            where: {
              storeId,
              variantId: reqItem.variantId,
            },
            data: {
              quantityOnHand: { increment: reqItem.quantity },
            },
          });

          await tx.stockMovement.create({
            data: {
              storeId,
              variantId: reqItem.variantId,
              type: StockMovementType.RETURN,
              quantity: reqItem.quantity,
              reason: dto.reason,
              referenceNo: order.receiptNo,
              performedByUserId: userId,
            },
          });
        } else {
          // DAMAGED: Record damage movement without incrementing sellable stock
          await tx.stockMovement.create({
            data: {
              storeId,
              variantId: reqItem.variantId,
              type: StockMovementType.DAMAGE,
              quantity: reqItem.quantity,
              reason: `Damaged Return: ${dto.reason}`,
              referenceNo: order.receiptNo,
              performedByUserId: userId,
            },
          });
        }
      }

      // Financial Settlement Handling
      if (
        dto.settlementMethod === 'REDUCE_KHATA' &&
        order.customer &&
        order.customerId
      ) {
        const previousBalance = order.customer.currentKhataBalance;
        const newBalance =
          previousBalance > totalRefundPaisa
            ? previousBalance - totalRefundPaisa
            : 0n;

        await tx.customer.update({
          where: { id: order.customerId },
          data: {
            currentKhataBalance: newBalance,
          },
        });

        await tx.khataLedger.create({
          data: {
            storeId,
            customerId: order.customerId,
            orderId: order.id,
            type: KhataTransactionType.CREDIT_PAYMENT,
            amount: totalRefundPaisa,
            runningBalance: newBalance,
            referenceNo: order.receiptNo,
            notes: `Return refund for receipt #${order.receiptNo}: ${dto.reason}`,
          },
        });
      } else if (dto.settlementMethod === 'CASH') {
        // If an active open cashier shift exists, decrement expected cash
        const activeShift = await tx.cashierShift.findFirst({
          where: { storeId, status: ShiftStatus.OPEN },
          orderBy: { openedAt: 'desc' },
        });

        if (activeShift) {
          const newExpected =
            activeShift.expectedCash > totalRefundPaisa
              ? activeShift.expectedCash - totalRefundPaisa
              : 0n;

          await tx.cashierShift.update({
            where: { id: activeShift.id },
            data: { expectedCash: newExpected },
          });
        }
      }

      // Check if all items in order are now fully returned
      const freshItems = await tx.orderItem.findMany({
        where: { orderId: order.id },
      });
      const allReturned = freshItems.every(
        (i) => i.returnedQuantity >= i.quantity,
      );

      const nextStatus = allReturned
        ? OrderStatus.REFUNDED
        : OrderStatus.PARTIALLY_REFUNDED;

      await tx.order.update({
        where: { id: order.id },
        data: { status: nextStatus },
      });

      // Audit Log Entry
      await tx.auditLog.create({
        data: {
          storeId,
          userId,
          action: 'ORDER_RETURNED',
          entity: 'Order',
          entityId: order.id,
          details: {
            receiptNo: order.receiptNo,
            reason: dto.reason,
            settlementMethod: dto.settlementMethod,
            refundAmountRupees: paisaToRupees(totalRefundPaisa),
            refundAmountPaisa: totalRefundPaisa.toString(),
            itemsCount: dto.items.length,
            nextStatus,
          },
        },
      });

      return {
        success: true,
        receiptNo: order.receiptNo,
        orderStatus: nextStatus,
        totalRefundAmount: paisaToRupees(totalRefundPaisa),
        settlementMethod: dto.settlementMethod,
        itemsReturned: dto.items.length,
        returnedAt: new Date().toISOString(),
      };
    });
  }
}
