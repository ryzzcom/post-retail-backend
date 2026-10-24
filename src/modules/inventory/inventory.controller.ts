import {
  Controller,
  Get,
  Post,
  Body,
  Query,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { StocktakeDto } from './dto/stocktake.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('api/v1/inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  async getStoreInventory(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.inventoryService.getStoreInventory(storeId, query);
  }

  @Post('adjust')
  @Roles(Role.OWNER, Role.MANAGER)
  async adjustStock(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.inventoryService.adjustStock(storeId, userId, dto);
  }

  @Post('stocktake')
  @Roles(Role.OWNER, Role.MANAGER)
  async processStocktake(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: StocktakeDto,
  ) {
    return this.inventoryService.processStocktake(storeId, userId, dto);
  }

  @Get('movements')
  async listMovements(
    @CurrentTenant('storeId') storeId: string,
    @Query() query?: PaginationQueryDto,
  ) {
    return this.inventoryService.listMovements(storeId, query);
  }
}
