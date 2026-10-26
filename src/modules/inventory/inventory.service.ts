import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { AdjustStockDto, AdjustmentType } from './dto/adjust-stock.dto';
import { BulkStocktakeDto } from './dto/stocktake.dto';
import { StockLedgerQueryDto } from './dto/stock-ledger-query.dto';
import { LabelsPreviewDto } from './dto/labels-preview.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { paisaToRupees } from '@core/utils/currency-paisa.util';
import { StockMovementType } from '@prisma/client';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get Store Inventory List with pagination
   */
  async getStoreInventory(storeId: string, query: PaginationQueryDto) {
    const where: any = { storeId };

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.variant = {
        OR: [
          { sku: { contains: term, mode: 'insensitive' as const } },
          { barcode: { contains: term, mode: 'insensitive' as const } },
          { product: { name: { contains: term, mode: 'insensitive' as const } } },
        ],
      };
    }

    const [total, items] = await Promise.all([
      this.prisma.storeInventory.count({ where }),
      this.prisma.storeInventory.findMany({
        where,
        include: {
          variant: {
            include: {
              product: { select: { id: true, name: true, styleCode: true, category: true } },
            },
          },
        },
        skip: query.skip,
        take: query.limit,
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return {
      data: items.map((inv) => ({
        id: inv.id,
        variantId: inv.variantId,
        quantityOnHand: inv.quantityOnHand,
        lowStockThreshold: inv.lowStockThreshold,
        sku: inv.variant.sku,
        barcode: inv.variant.barcode,
        color: inv.variant.color,
        size: inv.variant.size,
        costPrice: paisaToRupees(inv.variant.costPrice),
        retailPrice: paisaToRupees(inv.variant.retailPrice),
        product: inv.variant.product,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  /**
   * Adjust variant stock (ADD, DEDUCT, SET) with atomic ledger movement
   */
  async adjustStock(storeId: string, userId: string, dto: AdjustStockDto) {
    return this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: { id: dto.variantId, storeId },
        include: { product: true },
      });

      if (!variant) {
        throw new NotFoundException(`Variant with ID ${dto.variantId} not found in store`);
      }

      // Upsert current StoreInventory
      let inventory = await tx.storeInventory.findUnique({
        where: {
          storeId_variantId: { storeId, variantId: dto.variantId },
        },
      });

      if (!inventory) {
        inventory = await tx.storeInventory.create({
          data: {
            storeId,
            variantId: dto.variantId,
            quantityOnHand: 0,
            lowStockThreshold: variant.reorderLevel,
          },
        });
      }

      const previousQty = inventory.quantityOnHand;
      let newQty = previousQty;

      if (dto.adjustmentType === AdjustmentType.ADD) {
        newQty = previousQty + dto.quantity;
      } else if (dto.adjustmentType === AdjustmentType.DEDUCT) {
        newQty = Math.max(0, previousQty - dto.quantity);
      } else if (dto.adjustmentType === AdjustmentType.SET) {
        newQty = Math.max(0, dto.quantity);
      }

      const deltaQty = newQty - previousQty;

      // Update inventory quantity
      const updatedInventory = await tx.storeInventory.update({
        where: { id: inventory.id },
        data: {
          quantityOnHand: newQty,
          ...(dto.reorderLevel !== undefined ? { lowStockThreshold: dto.reorderLevel } : {}),
        },
      });

      // Update variant's reorderLevel if supplied
      if (dto.reorderLevel !== undefined) {
        await tx.productVariant.update({
          where: { id: variant.id },
          data: { reorderLevel: dto.reorderLevel },
        });
      }

      // Determine movement type
      let movementType: StockMovementType = StockMovementType.ADJUSTMENT;
      const cleanReason = (dto.reason || 'ADJUSTMENT').toUpperCase();

      if (cleanReason === 'DAMAGE') {
        movementType = StockMovementType.DAMAGE;
      } else if (cleanReason === 'RECEIVING' || cleanReason === 'TRANSFER_IN') {
        movementType = StockMovementType.TRANSFER_IN;
      } else if (cleanReason === 'RETURN') {
        movementType = StockMovementType.RETURN;
      }

      // Log movement record
      const movement = await tx.stockMovement.create({
        data: {
          storeId,
          variantId: variant.id,
          type: movementType,
          quantity: Math.abs(deltaQty),
          previousQty,
          newQty,
          reason: dto.reason || 'Manual Adjustment',
          note: dto.note || null,
          referenceNo: dto.referenceNo || null,
          performedByUserId: userId,
        },
      });

      return {
        success: true,
        variantId: variant.id,
        sku: variant.sku,
        previousQty,
        newQty,
        changeQty: deltaQty,
        quantityOnHand: updatedInventory.quantityOnHand,
        movementId: movement.id,
      };
    });
  }

  /**
   * Get physical stocktake audit sheet with all active variants
   */
  async getStocktakeSheet(storeId: string) {
    const variants = await this.prisma.productVariant.findMany({
      where: { storeId, isActive: true, product: { isArchived: false } },
      include: {
        product: { select: { id: true, name: true, styleCode: true } },
        inventory: { where: { storeId } },
      },
      orderBy: [{ product: { name: 'asc' } }, { size: 'asc' }, { color: 'asc' }],
    });

    return variants.map((v) => {
      const stockOnHand = v.inventory[0]?.quantityOnHand ?? 0;
      const colorSizeParts = [v.color, v.size].filter(Boolean);
      const colorSizeLabel =
        colorSizeParts.length > 0 ? colorSizeParts.join(' · ') : 'Standard';

      return {
        variantId: v.id,
        productId: v.product.id,
        productName: v.product.name,
        styleCode: v.product.styleCode,
        color: v.color,
        size: v.size,
        colorSizeLabel,
        sku: v.sku,
        barcode: v.barcode,
        systemQty: stockOnHand,
        costPrice: paisaToRupees(v.costPrice),
        retailPrice: paisaToRupees(v.retailPrice),
        reorderLevel: v.reorderLevel,
      };
    });
  }

  /**
   * Submit physical stocktake count with atomic variances & ledger movements
   */
  async processBulkStocktake(storeId: string, userId: string, dto: BulkStocktakeDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('No stocktake count items provided');
    }

    return this.prisma.$transaction(async (tx) => {
      let discrepanciesFound = 0;
      let netVarianceUnits = 0;
      let netVarianceCostPaisas = 0n;

      for (const item of dto.items) {
        const variant = await tx.productVariant.findFirst({
          where: { id: item.variantId, storeId },
        });

        if (!variant) continue;

        let inventory = await tx.storeInventory.findUnique({
          where: {
            storeId_variantId: { storeId, variantId: item.variantId },
          },
        });

        const previousQty = inventory ? inventory.quantityOnHand : 0;
        const countedQty = Math.max(0, item.countedQty);
        const variance = countedQty - previousQty;

        // If no inventory record existed, create one
        if (!inventory) {
          inventory = await tx.storeInventory.create({
            data: {
              storeId,
              variantId: item.variantId,
              quantityOnHand: countedQty,
              lowStockThreshold: variant.reorderLevel,
            },
          });
        } else if (variance !== 0) {
          await tx.storeInventory.update({
            where: { id: inventory.id },
            data: { quantityOnHand: countedQty },
          });
        }

        // Only log movement if count differed from system qty
        if (variance !== 0) {
          discrepanciesFound++;
          netVarianceUnits += variance;
          netVarianceCostPaisas += BigInt(variance) * variant.costPrice;

          await tx.stockMovement.create({
            data: {
              storeId,
              variantId: item.variantId,
              type: StockMovementType.STOCKTAKE,
              quantity: Math.abs(variance),
              previousQty,
              newQty: countedQty,
              reason: variance > 0 ? 'Stocktake Surplus' : 'Stocktake Deficit',
              note: item.note || dto.referenceNote || 'Physical stock audit',
              performedByUserId: userId,
            },
          });
        }
      }

      return {
        success: true,
        totalChecked: dto.items.length,
        discrepanciesFound,
        netVarianceUnits,
        netVarianceCostPKR: Math.round(paisaToRupees(netVarianceCostPaisas)),
        timestamp: new Date().toISOString(),
      };
    });
  }

  /**
   * Chronological Stock Movements Ledger with actor details & audit badges
   */
  async getStockLedger(storeId: string, query: StockLedgerQueryDto) {
    const where: any = { storeId };

    if (query.variantId) {
      where.variantId = query.variantId;
    }

    if (query.type && query.type.toUpperCase() !== 'ALL') {
      const typeEnum = query.type.toUpperCase() as StockMovementType;
      if (Object.values(StockMovementType).includes(typeEnum)) {
        where.type = typeEnum;
      }
    }

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.variant = {
        OR: [
          { sku: { contains: term, mode: 'insensitive' as const } },
          { barcode: { contains: term, mode: 'insensitive' as const } },
          { product: { name: { contains: term, mode: 'insensitive' as const } } },
        ],
      };
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    const [total, items] = await Promise.all([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        include: {
          variant: {
            include: {
              product: { select: { id: true, name: true, styleCode: true } },
            },
          },
          performedBy: {
            select: { id: true, fullName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
    ]);

    const formattedData = items.map((m) => {
      let changeQty = 0;
      if (m.newQty !== null && m.previousQty !== null) {
        changeQty = m.newQty - m.previousQty;
      } else if (
        m.type === StockMovementType.OPENING_STOCK ||
        m.type === StockMovementType.TRANSFER_IN ||
        m.type === StockMovementType.RETURN ||
        m.type === StockMovementType.IN
      ) {
        changeQty = m.quantity;
      } else {
        changeQty = -m.quantity;
      }

      const colorSizeParts = [m.variant?.color, m.variant?.size].filter(Boolean);
      const colorSizeLabel =
        colorSizeParts.length > 0 ? colorSizeParts.join(' · ') : 'Standard';

      return {
        id: m.id,
        createdAt: m.createdAt,
        type: m.type,
        productId: m.variant?.product?.id,
        productName: m.variant?.product?.name || 'Unknown Product',
        styleCode: m.variant?.product?.styleCode,
        variantId: m.variantId,
        sku: m.variant?.sku,
        barcode: m.variant?.barcode,
        colorSizeLabel,
        changeQty,
        changeQtyFormatted: changeQty > 0 ? `+${changeQty}` : `${changeQty}`,
        previousQty: m.previousQty,
        newQty: m.newQty,
        actorName: m.performedBy?.fullName || 'System',
        note: m.note || m.reason || '',
        referenceNo: m.referenceNo || null,
      };
    });

    return {
      data: formattedData,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  /**
   * Generate Barcode Sticker Label Printing Preview data
   */
  async generateLabelsPreview(storeId: string, dto: LabelsPreviewDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('No label items provided');
    }

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });

    const storeName = store?.name || 'Retail Store';
    const variantIds = dto.items.map((i) => i.variantId);

    const variants = await this.prisma.productVariant.findMany({
      where: { storeId, id: { in: variantIds } },
      include: {
        product: { select: { id: true, name: true, styleCode: true } },
      },
    });

    const variantMap = new Map(variants.map((v) => [v.id, v]));

    const labels = [];
    for (const item of dto.items) {
      const v = variantMap.get(item.variantId);
      if (!v) continue;

      const retailRupees = paisaToRupees(v.retailPrice);
      const colorSizeParts = [v.color, v.size].filter(Boolean);
      const colorSize =
        colorSizeParts.length > 0 ? colorSizeParts.join(' · ') : 'Standard';

      labels.push({
        variantId: v.id,
        copies: item.copies || 1,
        storeName,
        productName: v.product.name,
        styleCode: v.product.styleCode || null,
        colorSize,
        sku: v.sku,
        barcode: v.barcode || '',
        retailPrice: retailRupees,
        retailPriceFormatted: `Rs. ${retailRupees.toLocaleString('en-PK')}`,
      });
    }

    return {
      storeName,
      totalLabels: labels.reduce((sum, l) => sum + l.copies, 0),
      items: labels,
    };
  }
}
