import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { CheckoutDto } from './dto/checkout.dto';
import { HoldBillDto } from './dto/hold-bill.dto';
import { ReturnOrderDto } from './dto/return-order.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { rupeesToPaisa } from '@core/utils/currency-paisa.util';
import { HeldBillStatus, OrderStatus } from '@prisma/client';

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService) {}

  async checkout(
    storeId: string,
    cashierId: string,
    idempotencyKey: string,
    dto: CheckoutDto,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Checkout requires at least one order item');
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
    const grandTotalPaisa = subtotalPaisa - orderDiscountPaisa;

    // Generate unique receipt number
    const receiptNo = `REC-${Date.now().toString(36).toUpperCase()}-${Math.floor(
      1000 + Math.random() * 9000,
    )}`;

    return this.prisma.$transaction(async (tx) => {
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

      // Deduct inventory quantities from store inventory
      for (const item of dto.items) {
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
      }

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
      where: { id },
      data: { status: HeldBillStatus.RESUMED },
    });
  }

  async returnOrder(storeId: string, cashierId: string, dto: ReturnOrderDto) {
    const originalOrder = await this.prisma.order.findFirst({
      where: { id: dto.originalOrderId, storeId },
      include: { items: true },
    });

    if (!originalOrder) {
      throw new NotFoundException(`Order ${dto.originalOrderId} not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id: dto.originalOrderId },
        data: {
          status: OrderStatus.REFUNDED,
          notes: `Refunded: ${dto.reason}`,
        },
      });

      // Restock returned items in store inventory
      for (const item of dto.items) {
        const orderItem = originalOrder.items.find((i) => i.id === item.orderItemId);
        if (orderItem) {
          await tx.storeInventory.updateMany({
            where: {
              storeId,
              variantId: orderItem.variantId,
            },
            data: {
              quantityOnHand: { increment: item.quantity },
            },
          });
        }
      }

      return updatedOrder;
    });
  }

  async getOrderById(storeId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, storeId },
      include: {
        items: { include: { variant: true } },
        payments: true,
        customer: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    return order;
  }

  async listOrders(storeId: string, query: PaginationQueryDto) {
    const where = { storeId };

    const [total, items] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: {
          items: true,
          payments: true,
          customer: true,
        },
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data: items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}
