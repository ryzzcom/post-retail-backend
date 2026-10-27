import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { PurchaseQueryDto } from './dto/purchase-query.dto';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { RecordSupplierPaymentDto } from './dto/record-supplier-payment.dto';
import { paisaToRupees, rupeesToPaisa } from '@core/utils/currency-paisa.util';
import {
  PaymentMethod,
  PurchasePaymentStatus,
  PurchaseStatus,
  ShiftStatus,
  StockMovementType,
  SupplierLedgerType,
} from '@prisma/client';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

function formatDateTime(date: Date): string {
  const d = new Date(date);
  const datePart = formatDate(d);
  const timePart = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  return `${datePart}, ${timePart}`;
}

@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService) {}

  // ===========================================================================
  // 1. Purchases Endpoints
  // ===========================================================================

  /**
   * List Purchase Orders with parallel Top Summary Strip KPIs
   */
  async listPurchaseOrders(storeId: string, query: PurchaseQueryDto) {
    const where: any = { storeId };

    if (query.status && query.status.toUpperCase() !== 'ALL') {
      const s = query.status.toUpperCase() as PurchaseStatus;
      if (Object.values(PurchaseStatus).includes(s)) {
        where.status = s;
      }
    }

    if (query.paymentStatus && query.paymentStatus.toUpperCase() !== 'ALL') {
      const ps = query.paymentStatus.toUpperCase() as PurchasePaymentStatus;
      if (Object.values(PurchasePaymentStatus).includes(ps)) {
        where.paymentStatus = ps;
      }
    }

    if (query.supplierId) {
      where.supplierId = query.supplierId;
    }

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { poNumber: { contains: term, mode: 'insensitive' as const } },
        { invoiceRef: { contains: term, mode: 'insensitive' as const } },
        { supplier: { name: { contains: term, mode: 'insensitive' as const } } },
      ];
    }

    if (query.startDate || query.endDate) {
      where.orderDate = {};
      if (query.startDate) {
        where.orderDate.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.orderDate.lte = new Date(query.endDate);
      }
    }

    const [
      totalPOsCount,
      pendingOrdersCount,
      receivedShipmentsCount,
      totalCostAggregate,
      totalMatching,
      rawOrders,
    ] = await Promise.all([
      // 1. Total POs in store
      this.prisma.purchaseOrder.count({ where: { storeId } }),

      // 2. Pending orders count (ORDERED or PARTIALLY_RECEIVED)
      this.prisma.purchaseOrder.count({
        where: {
          storeId,
          status: { in: [PurchaseStatus.ORDERED, PurchaseStatus.PARTIALLY_RECEIVED] },
        },
      }),

      // 3. Received shipments count
      this.prisma.purchaseOrder.count({
        where: { storeId, status: PurchaseStatus.RECEIVED },
      }),

      // 4. Sum of total bill amount in store
      this.prisma.purchaseOrder.aggregate({
        where: { storeId },
        _sum: { totalBillAmount: true },
      }),

      // 5. Total matching count for pagination
      this.prisma.purchaseOrder.count({ where }),

      // 6. Paginated items
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          items: { select: { id: true, orderedQty: true, receivedQty: true } },
        },
        orderBy: { orderDate: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
    ]);

    const totalPurchasesCostPKR = Math.round(
      paisaToRupees(totalCostAggregate._sum.totalBillAmount || 0n),
    );

    const items = rawOrders.map((po) => ({
      id: po.id,
      poNumber: po.poNumber,
      orderDate: po.orderDate.toISOString(),
      orderDateFormatted: formatDate(po.orderDate),
      expectedDueDateFormatted: po.expectedDueDate ? formatDate(po.expectedDueDate) : null,
      supplier: { id: po.supplier.id, name: po.supplier.name },
      itemsSummary: `${po.items.length} items · ${po.totalOrderedQty} pcs`,
      totalOrderedQty: po.totalOrderedQty,
      totalReceivedQty: po.totalReceivedQty,
      totalBillAmount: paisaToRupees(po.totalBillAmount),
      amountPaid: paisaToRupees(po.amountPaid),
      remainingDue: paisaToRupees(po.remainingDue),
      status: po.status,
      paymentStatus: po.paymentStatus,
    }));

    return {
      summary: {
        totalPOsCount,
        pendingOrdersCount,
        receivedShipmentsCount,
        totalPurchasesCostPKR,
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
   * Fetch single Purchase Order by ID or poNumber (powers Purchase Detail Modal)
   */
  async getPurchaseOrderByIdOrPo(storeId: string, idOrPoNumber: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: {
        storeId,
        OR: [{ id: idOrPoNumber }, { poNumber: idOrPoNumber }],
      },
      include: {
        supplier: true,
        items: {
          include: {
            variant: {
              include: {
                product: { select: { id: true, name: true, styleCode: true } },
              },
            },
          },
          orderBy: { sku: 'asc' },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!po) {
      throw new NotFoundException(`Purchase order "${idOrPoNumber}" not found`);
    }

    const percentage =
      po.totalOrderedQty > 0
        ? Math.min(100, Math.round((po.totalReceivedQty / po.totalOrderedQty) * 100))
        : 0;

    const items = po.items.map((item) => {
      const unitCost = paisaToRupees(item.unitCostPrice);
      const lineTotal = paisaToRupees(item.lineTotal);

      return {
        id: item.id,
        variantId: item.variantId,
        productName: item.productName,
        variantLabel: item.variantLabel,
        sku: item.sku,
        unitCostPrice: unitCost,
        orderedQty: item.orderedQty,
        receivedQty: item.receivedQty,
        qtyPriceLabel: `Qty: ${item.orderedQty} × Rs. ${unitCost.toLocaleString('en-PK')}`,
        lineTotal,
        receivedStatusLabel: `Received: ${item.receivedQty} / ${item.orderedQty}`,
      };
    });

    const totalBillAmount = paisaToRupees(po.totalBillAmount);
    const amountPaid = paisaToRupees(po.amountPaid);
    const remainingDue = paisaToRupees(po.remainingDue);

    return {
      id: po.id,
      poNumber: po.poNumber,
      orderDate: po.orderDate.toISOString(),
      orderDateFormatted: formatDate(po.orderDate),
      expectedDueDate: po.expectedDueDate ? po.expectedDueDate.toISOString() : null,
      expectedDueDateFormatted: po.expectedDueDate ? formatDate(po.expectedDueDate) : null,
      invoiceRef: po.invoiceRef,
      status: po.status,
      paymentStatus: po.paymentStatus,
      notes: po.notes,
      supplier: {
        id: po.supplier.id,
        name: po.supplier.name,
        contactPerson: po.supplier.contactPerson,
        phone: po.supplier.phone,
        email: po.supplier.email,
        city: po.supplier.city,
        address: po.supplier.address,
        currentPayableBalance: paisaToRupees(po.supplier.currentPayableBalance),
      },
      deliveryProgress: {
        receivedItems: po.totalReceivedQty,
        totalItems: po.totalOrderedQty,
        percentage,
      },
      items,
      financials: {
        paymentStatus: po.paymentStatus,
        totalBillAmount,
        amountPaid,
        remainingDue,
      },
      payments: po.payments.map((p) => ({
        id: p.id,
        amount: paisaToRupees(p.amount),
        paymentMethod: p.paymentMethod,
        reference: p.reference,
        notes: p.notes,
        createdAt: p.createdAt.toISOString(),
        dateFormatted: formatDateTime(p.createdAt),
      })),
    };
  }

  /**
   * Create new Purchase Order with variant lines, direct receiving option, and supplier ledger updates
   */
  async createPurchaseOrder(
    storeId: string,
    userId: string,
    dto: CreatePurchaseOrderDto,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one purchase item is required');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Verify Supplier belongs to store
      const supplier = await tx.supplier.findFirst({
        where: { id: dto.supplierId, storeId },
      });
      if (!supplier) {
        throw new NotFoundException(`Supplier with ID ${dto.supplierId} not found`);
      }

      // 2. Generate sequential PO Number (e.g. PO-000041)
      const latestPo = await tx.purchaseOrder.findFirst({
        where: { storeId },
        orderBy: { createdAt: 'desc' },
        select: { poNumber: true },
      });

      let nextPoNumber = 'PO-000001';
      if (latestPo) {
        const match = latestPo.poNumber.match(/PO-(\d+)/i);
        if (match) {
          const nextVal = parseInt(match[1], 10) + 1;
          nextPoNumber = `PO-${nextVal.toString().padStart(6, '0')}`;
        } else {
          const count = await tx.purchaseOrder.count({ where: { storeId } });
          nextPoNumber = `PO-${(count + 1).toString().padStart(6, '0')}`;
        }
      }

      // 3. Resolve variant details and compute totals
      let totalOrderedQty = 0;
      let totalBillAmountPaisa = 0n;

      const preparedItems = [];
      for (const itemDto of dto.items) {
        const variant = await tx.productVariant.findFirst({
          where: { id: itemDto.variantId, storeId },
          include: { product: true },
        });

        if (!variant) {
          throw new NotFoundException(
            `Variant with ID ${itemDto.variantId} not found in this store`,
          );
        }

        const colorSizeParts = [variant.color, variant.size].filter(Boolean);
        const variantLabel =
          colorSizeParts.length > 0 ? colorSizeParts.join(' · ') : 'Standard';

        const unitCostPaisa = rupeesToPaisa(itemDto.unitCostPrice);
        const lineTotalPaisa = BigInt(itemDto.orderedQty) * unitCostPaisa;

        totalOrderedQty += itemDto.orderedQty;
        totalBillAmountPaisa += lineTotalPaisa;

        preparedItems.push({
          variantId: variant.id,
          productName: variant.product.name,
          variantLabel,
          sku: variant.sku,
          unitCostPrice: unitCostPaisa,
          orderedQty: itemDto.orderedQty,
          receivedQty: dto.directReceiveStockNow ? itemDto.orderedQty : 0,
          lineTotal: lineTotalPaisa,
        });
      }

      const amountPaidPaisa = rupeesToPaisa(dto.amountPaid || 0);
      const remainingDuePaisa =
        totalBillAmountPaisa > amountPaidPaisa
          ? totalBillAmountPaisa - amountPaidPaisa
          : 0n;

      let paymentStatus: PurchasePaymentStatus = PurchasePaymentStatus.UNPAID;
      if (amountPaidPaisa >= totalBillAmountPaisa && totalBillAmountPaisa > 0n) {
        paymentStatus = PurchasePaymentStatus.PAID;
      } else if (amountPaidPaisa > 0n) {
        paymentStatus = PurchasePaymentStatus.PARTIAL;
      }

      const initialStatus = dto.directReceiveStockNow
        ? PurchaseStatus.RECEIVED
        : PurchaseStatus.ORDERED;
      const initialReceivedQty = dto.directReceiveStockNow ? totalOrderedQty : 0;

      // 4. Create Purchase Order
      const po = await tx.purchaseOrder.create({
        data: {
          storeId,
          supplierId: supplier.id,
          poNumber: nextPoNumber,
          orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(),
          expectedDueDate: dto.expectedDueDate ? new Date(dto.expectedDueDate) : null,
          invoiceRef: dto.invoiceRef?.trim() || null,
          status: initialStatus,
          paymentStatus,
          totalBillAmount: totalBillAmountPaisa,
          amountPaid: amountPaidPaisa,
          remainingDue: remainingDuePaisa,
          totalOrderedQty,
          totalReceivedQty: initialReceivedQty,
          notes: dto.notes?.trim() || null,
        },
      });

      // 5. Create Line Items
      for (const pItem of preparedItems) {
        await tx.purchaseOrderItem.create({
          data: {
            purchaseOrderId: po.id,
            variantId: pItem.variantId,
            productName: pItem.productName,
            variantLabel: pItem.variantLabel,
            sku: pItem.sku,
            unitCostPrice: pItem.unitCostPrice,
            orderedQty: pItem.orderedQty,
            receivedQty: pItem.receivedQty,
            lineTotal: pItem.lineTotal,
          },
        });

        // If directReceiveStockNow is true, increment inventory and log movement
        if (dto.directReceiveStockNow) {
          const inv = await tx.storeInventory.upsert({
            where: {
              storeId_variantId: { storeId, variantId: pItem.variantId },
            },
            update: {
              quantityOnHand: { increment: pItem.orderedQty },
            },
            create: {
              storeId,
              variantId: pItem.variantId,
              quantityOnHand: pItem.orderedQty,
            },
          });

          await tx.stockMovement.create({
            data: {
              storeId,
              variantId: pItem.variantId,
              type: StockMovementType.RECEIVING,
              quantity: pItem.orderedQty,
              previousQty: inv.quantityOnHand - pItem.orderedQty,
              newQty: inv.quantityOnHand,
              note: `Direct stock receiving for PO ${nextPoNumber}`,
              referenceNo: nextPoNumber,
              performedByUserId: userId,
            },
          });
        }
      }

      // 6. Supplier Ledger & Financial Accounts Updates
      // Step A: Log Bill Invoice entry (increases payable balance)
      const balanceAfterBill = supplier.currentPayableBalance + totalBillAmountPaisa;
      await tx.supplierLedger.create({
        data: {
          storeId,
          supplierId: supplier.id,
          purchaseOrderId: po.id,
          type: SupplierLedgerType.BILL_INVOICE,
          amount: totalBillAmountPaisa,
          runningBalance: balanceAfterBill,
          description: `Purchase Order ${nextPoNumber}`,
        },
      });

      let finalSupplierBalance = balanceAfterBill;

      // Step B: If initial amount was paid, create payment record and ledger entry
      if (amountPaidPaisa > 0n) {
        finalSupplierBalance = balanceAfterBill - amountPaidPaisa;

        const payment = await tx.supplierPayment.create({
          data: {
            storeId,
            supplierId: supplier.id,
            purchaseOrderId: po.id,
            amount: amountPaidPaisa,
            paymentMethod: dto.paymentMethod || PaymentMethod.CASH,
            reference: nextPoNumber,
            notes: dto.notes?.trim() || 'Initial payment on order placement',
            createdById: userId,
          },
        });

        await tx.supplierLedger.create({
          data: {
            storeId,
            supplierId: supplier.id,
            purchaseOrderId: po.id,
            paymentId: payment.id,
            type: SupplierLedgerType.PAYMENT_MADE,
            amount: amountPaidPaisa,
            runningBalance: finalSupplierBalance,
            description: `Payment for Purchase Order ${nextPoNumber}`,
          },
        });

        // If paid in cash, decrement cash drawer on active shift
        if (dto.paymentMethod === PaymentMethod.CASH) {
          const activeShift = await tx.cashierShift.findFirst({
            where: { storeId, status: ShiftStatus.OPEN },
            orderBy: { openedAt: 'desc' },
          });
          if (activeShift) {
            const newExpected =
              activeShift.expectedCash > amountPaidPaisa
                ? activeShift.expectedCash - amountPaidPaisa
                : 0n;
            await tx.cashierShift.update({
              where: { id: activeShift.id },
              data: { expectedCash: newExpected },
            });
          }
        }
      }

      // Update supplier's current payable balance
      await tx.supplier.update({
        where: { id: supplier.id },
        data: { currentPayableBalance: finalSupplierBalance },
      });

      return po;
    }).then((po) => this.getPurchaseOrderByIdOrPo(storeId, po.id));
  }

  /**
   * Receive stock for a Purchase Order (converts ORDERED -> RECEIVED or PARTIALLY_RECEIVED)
   */
  async receiveStock(
    storeId: string,
    userId: string,
    idOrPoNumber: string,
    dto: ReceiveStockDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: {
          storeId,
          OR: [{ id: idOrPoNumber }, { poNumber: idOrPoNumber }],
        },
        include: { items: true },
      });

      if (!po) {
        throw new NotFoundException(`Purchase order "${idOrPoNumber}" not found`);
      }

      if (po.status === PurchaseStatus.RECEIVED) {
        throw new BadRequestException('This purchase order is already fully received');
      }

      if (po.status === PurchaseStatus.CANCELLED) {
        throw new BadRequestException('Cannot receive stock for a cancelled purchase order');
      }

      const itemMap = new Map(po.items.map((it) => [it.id, it]));

      // Determine items to receive: specific items or 100% of remaining items
      const receiveList: Array<{ item: (typeof po.items)[0]; qty: number }> = [];

      if (dto.items && dto.items.length > 0) {
        for (const rItem of dto.items) {
          const item = itemMap.get(rItem.itemId);
          if (!item) {
            throw new NotFoundException(
              `Item ${rItem.itemId} does not belong to purchase order ${po.poNumber}`,
            );
          }
          const remaining = item.orderedQty - item.receivedQty;
          if (rItem.receiveQty > remaining) {
            throw new BadRequestException(
              `Cannot receive ${rItem.receiveQty} for SKU ${item.sku}. Only ${remaining} remaining to receive.`,
            );
          }
          if (rItem.receiveQty > 0) {
            receiveList.push({ item, qty: rItem.receiveQty });
          }
        }
      } else {
        // Receive 100% of remaining
        for (const item of po.items) {
          const remaining = item.orderedQty - item.receivedQty;
          if (remaining > 0) {
            receiveList.push({ item, qty: remaining });
          }
        }
      }

      if (receiveList.length === 0) {
        throw new BadRequestException('No items or quantities to receive');
      }

      // Process stock increment & movements
      for (const { item, qty } of receiveList) {
        const inv = await tx.storeInventory.upsert({
          where: {
            storeId_variantId: { storeId, variantId: item.variantId },
          },
          update: {
            quantityOnHand: { increment: qty },
          },
          create: {
            storeId,
            variantId: item.variantId,
            quantityOnHand: qty,
          },
        });

        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { receivedQty: { increment: qty } },
        });

        await tx.stockMovement.create({
          data: {
            storeId,
            variantId: item.variantId,
            type: StockMovementType.RECEIVING,
            quantity: qty,
            previousQty: inv.quantityOnHand - qty,
            newQty: inv.quantityOnHand,
            note: dto.note || `Stock received for PO ${po.poNumber}`,
            referenceNo: po.poNumber,
            performedByUserId: userId,
          },
        });
      }

      // Recompute total received quantity
      const allUpdatedItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: po.id },
      });

      const newTotalReceived = allUpdatedItems.reduce(
        (sum, it) => sum + it.receivedQty,
        0,
      );

      let newStatus: PurchaseStatus = PurchaseStatus.ORDERED;
      if (newTotalReceived >= po.totalOrderedQty) {
        newStatus = PurchaseStatus.RECEIVED;
      } else if (newTotalReceived > 0) {
        newStatus = PurchaseStatus.PARTIALLY_RECEIVED;
      }

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          totalReceivedQty: newTotalReceived,
          status: newStatus,
        },
      });

      return po.id;
    }).then((poId) => this.getPurchaseOrderByIdOrPo(storeId, poId));
  }

  // ===========================================================================
  // 2. Suppliers Endpoints
  // ===========================================================================

  /**
   * List Suppliers with Total Payables KPI Strip
   */
  async listSuppliers(storeId: string, query: SupplierQueryDto) {
    const where: any = { storeId };

    if (query.filter === 'OUTSTANDING_ONLY') {
      where.currentPayableBalance = { gt: 0n };
    } else if (query.filter === 'SETTLED') {
      where.currentPayableBalance = { lte: 0n };
    }

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' as const } },
        { phone: { contains: term, mode: 'insensitive' as const } },
        { contactPerson: { contains: term, mode: 'insensitive' as const } },
        { city: { contains: term, mode: 'insensitive' as const } },
      ];
    }

    const [
      totalSuppliersCount,
      activeSuppliersCount,
      payablesAggregate,
      totalMatching,
      rawSuppliers,
    ] = await Promise.all([
      // 1. Total suppliers
      this.prisma.supplier.count({ where: { storeId } }),

      // 2. Active suppliers
      this.prisma.supplier.count({ where: { storeId, isActive: true } }),

      // 3. Total payables (positive balances)
      this.prisma.supplier.aggregate({
        where: { storeId, currentPayableBalance: { gt: 0n } },
        _sum: { currentPayableBalance: true },
      }),

      // 4. Count matching for pagination
      this.prisma.supplier.count({ where }),

      // 5. Paginated suppliers
      this.prisma.supplier.findMany({
        where,
        include: {
          _count: { select: { purchaseOrders: true } },
        },
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
    ]);

    const totalPayablesPKR = Math.round(
      paisaToRupees(payablesAggregate._sum.currentPayableBalance || 0n),
    );

    const items = rawSuppliers.map((s) => {
      const outstandingBalance = paisaToRupees(s.currentPayableBalance);
      return {
        id: s.id,
        name: s.name,
        contactPerson: s.contactPerson,
        phone: s.phone,
        city: s.city,
        totalOrdersCount: s._count.purchaseOrders,
        outstandingBalance,
        hasOutstanding: s.currentPayableBalance > 0n,
      };
    });

    return {
      summary: {
        totalSuppliersCount,
        activeSuppliersCount,
        totalPayablesPKR,
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
   * Create Supplier with optional opening payable balance
   */
  async createSupplier(storeId: string, dto: CreateSupplierDto) {
    const existing = await this.prisma.supplier.findFirst({
      where: { storeId, phone: dto.phone.trim() },
    });

    if (existing) {
      throw new ConflictException(
        `A supplier with phone number "${dto.phone}" already exists in your store`,
      );
    }

    const openingBalancePaisa = rupeesToPaisa(dto.openingBalance || 0);

    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          storeId,
          name: dto.name.trim(),
          contactPerson: dto.contactPerson?.trim() || null,
          phone: dto.phone.trim(),
          email: dto.email?.trim() || null,
          ntn: dto.ntn?.trim() || null,
          city: dto.city?.trim() || null,
          address: dto.address?.trim() || null,
          openingBalance: openingBalancePaisa,
          currentPayableBalance: openingBalancePaisa,
          notes: dto.notes?.trim() || null,
        },
      });

      if (openingBalancePaisa > 0n) {
        await tx.supplierLedger.create({
          data: {
            storeId,
            supplierId: supplier.id,
            type: SupplierLedgerType.OPENING_BALANCE,
            amount: openingBalancePaisa,
            runningBalance: openingBalancePaisa,
            description: 'Opening payable balance',
          },
        });
      }

      return {
        ...supplier,
        openingBalance: dto.openingBalance || 0,
        currentPayableBalance: dto.openingBalance || 0,
      };
    });
  }

  /**
   * Record payment to supplier (powers Supplier Pay Modal)
   */
  async recordSupplierPayment(
    storeId: string,
    userId: string,
    supplierId: string,
    dto: RecordSupplierPaymentDto,
  ) {
    const paymentPaisa = rupeesToPaisa(dto.amount);
    if (paymentPaisa <= 0n) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: supplierId, storeId },
      });

      if (!supplier) {
        throw new NotFoundException(`Supplier with ID ${supplierId} not found`);
      }

      const newBalancePaisa = supplier.currentPayableBalance - paymentPaisa;

      // 1. Create Supplier Payment record
      const payment = await tx.supplierPayment.create({
        data: {
          storeId,
          supplierId,
          purchaseOrderId: dto.purchaseOrderId || null,
          amount: paymentPaisa,
          paymentMethod: dto.paymentMethod || PaymentMethod.CASH,
          reference: dto.reference?.trim() || null,
          notes: dto.notes?.trim() || null,
          createdById: userId,
        },
      });

      // 2. Create Supplier Ledger entry
      await tx.supplierLedger.create({
        data: {
          storeId,
          supplierId,
          paymentId: payment.id,
          purchaseOrderId: dto.purchaseOrderId || null,
          type: SupplierLedgerType.PAYMENT_MADE,
          amount: paymentPaisa,
          runningBalance: newBalancePaisa,
          description:
            dto.notes ||
            (dto.purchaseOrderId
              ? 'Payment towards purchase order'
              : 'Payment made to supplier'),
        },
      });

      // 3. Update Supplier Payable Balance
      await tx.supplier.update({
        where: { id: supplierId },
        data: { currentPayableBalance: newBalancePaisa },
      });

      // 4. If linked to a PO, update the PO financial status
      if (dto.purchaseOrderId) {
        const po = await tx.purchaseOrder.findFirst({
          where: { id: dto.purchaseOrderId, storeId },
        });

        if (po) {
          const newPaid = po.amountPaid + paymentPaisa;
          const newRemaining =
            po.totalBillAmount > newPaid ? po.totalBillAmount - newPaid : 0n;
          const newPaymentStatus =
            newRemaining === 0n
              ? PurchasePaymentStatus.PAID
              : PurchasePaymentStatus.PARTIAL;

          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: {
              amountPaid: newPaid,
              remainingDue: newRemaining,
              paymentStatus: newPaymentStatus,
            },
          });
        }
      }

      // 5. If paid in cash, decrement cash drawer on active cashier shift
      if (dto.paymentMethod === PaymentMethod.CASH) {
        const activeShift = await tx.cashierShift.findFirst({
          where: { storeId, status: ShiftStatus.OPEN },
          orderBy: { openedAt: 'desc' },
        });
        if (activeShift) {
          const newExpected =
            activeShift.expectedCash > paymentPaisa
              ? activeShift.expectedCash - paymentPaisa
              : 0n;
          await tx.cashierShift.update({
            where: { id: activeShift.id },
            data: { expectedCash: newExpected },
          });
        }
      }

      return {
        success: true,
        paymentId: payment.id,
        supplierId,
        paidAmount: dto.amount,
        remainingPayableBalance: paisaToRupees(newBalancePaisa),
      };
    });
  }

  /**
   * Get Chronological Supplier Ledger Drawer
   */
  async getSupplierLedger(storeId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, storeId },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID ${supplierId} not found`);
    }

    const entries = await this.prisma.supplierLedger.findMany({
      where: { storeId, supplierId },
      include: {
        purchaseOrder: { select: { poNumber: true } },
        payment: { select: { reference: true, paymentMethod: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedEntries = entries.map((e) => {
      const isDebitInvoice =
        e.type === SupplierLedgerType.BILL_INVOICE ||
        (e.type === SupplierLedgerType.OPENING_BALANCE && e.amount > 0n);
      const isCreditPayment = e.type === SupplierLedgerType.PAYMENT_MADE;

      return {
        id: e.id,
        type: e.type,
        dateFormatted: formatDateTime(e.createdAt),
        description: e.description,
        billAmount: isDebitInvoice ? paisaToRupees(e.amount) : null,
        paidAmount: isCreditPayment ? paisaToRupees(e.amount) : null,
        runningBalance: paisaToRupees(e.runningBalance),
        reference:
          e.payment?.reference || e.purchaseOrder?.poNumber || null,
        paymentMethod: e.payment?.paymentMethod || null,
      };
    });

    return {
      supplier: {
        id: supplier.id,
        name: supplier.name,
        contactPerson: supplier.contactPerson,
        phone: supplier.phone,
        city: supplier.city,
        currentPayableBalance: paisaToRupees(supplier.currentPayableBalance),
      },
      entries: formattedEntries,
    };
  }
}
