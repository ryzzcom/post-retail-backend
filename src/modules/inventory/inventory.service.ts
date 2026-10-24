import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { StocktakeDto } from './dto/stocktake.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { StockMovementType } from '@prisma/client';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getStoreInventory(
    storeId: string,
    query: PaginationQueryDto,
  ) {
    const where = {
      storeId,
    };

    const [total, items] = await Promise.all([
      this.prisma.storeInventory.count({ where }),
      this.prisma.storeInventory.findMany({
        where,
        include: {
          variant: {
            include: {
              product: true,
            },
          },
        },
        skip: query.skip,
        take: query.limit,
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

  async adjustStock(storeId: string, userId: string, dto: AdjustStockDto) {
    return this.prisma.$transaction(async (tx) => {
      const inventory = await tx.storeInventory.upsert({
        where: {
          storeId_variantId: {
            storeId,
            variantId: dto.variantId,
          },
        },
        update: {
          quantityOnHand: {
            increment: dto.quantityDelta,
          },
        },
        create: {
          storeId,
          variantId: dto.variantId,
          quantityOnHand: Math.max(0, dto.quantityDelta),
        },
      });

      await tx.stockMovement.create({
        data: {
          storeId,
          variantId: dto.variantId,
          type: dto.quantityDelta >= 0 ? StockMovementType.IN : StockMovementType.OUT,
          quantity: Math.abs(dto.quantityDelta),
          reason: dto.reason || 'Manual Adjustment',
          referenceNo: dto.referenceNo,
          performedByUserId: userId,
        },
      });

      return inventory;
    });
  }

  async processStocktake(storeId: string, userId: string, dto: StocktakeDto) {
    return this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        await tx.storeInventory.upsert({
          where: {
            storeId_variantId: {
              storeId,
              variantId: item.variantId,
            },
          },
          update: {
            quantityOnHand: item.countedQuantity,
          },
          create: {
            storeId,
            variantId: item.variantId,
            quantityOnHand: item.countedQuantity,
          },
        });

        await tx.stockMovement.create({
          data: {
            storeId,
            variantId: item.variantId,
            type: StockMovementType.ADJUSTMENT,
            quantity: item.countedQuantity,
            reason: dto.notes || 'Full Stocktake Count',
            performedByUserId: userId,
          },
        });
      }

      return { success: true, count: dto.items.length };
    });
  }

  async listMovements(
    storeId: string,
    query?: PaginationQueryDto,
  ) {
    const where = {
      storeId,
    };

    const limit = query?.limit || 20;
    const skip = query?.skip || 0;

    const [total, items] = await Promise.all([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        include: {
          variant: true,
          performedBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: items,
      meta: {
        page: query?.page || 1,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
