import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { BulkStocktakeDto } from './dto/stocktake.dto';
import { StockLedgerQueryDto } from './dto/stock-ledger-query.dto';
import { LabelsPreviewDto } from './dto/labels-preview.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Role } from '@prisma/client';

@Controller('api/v1/inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
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

  @Get('stocktake')
  @Roles(Role.OWNER, Role.MANAGER)
  async getStocktakeSheet(@CurrentTenant('storeId') storeId: string) {
    return this.inventoryService.getStocktakeSheet(storeId);
  }

  @Post('stocktake')
  @Roles(Role.OWNER, Role.MANAGER)
  async processBulkStocktake(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: BulkStocktakeDto,
  ) {
    return this.inventoryService.processBulkStocktake(storeId, userId, dto);
  }

  @Get('ledger')
  @Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
  async getStockLedger(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: StockLedgerQueryDto,
  ) {
    return this.inventoryService.getStockLedger(storeId, query);
  }

  @Post('labels-preview')
  @Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
  async generateLabelsPreview(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: LabelsPreviewDto,
  ) {
    return this.inventoryService.generateLabelsPreview(storeId, dto);
  }
}
