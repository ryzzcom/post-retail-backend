import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { PurchaseQueryDto } from './dto/purchase-query.dto';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { RecordSupplierPaymentDto } from './dto/record-supplier-payment.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Role } from '@prisma/client';

@Controller('api/v1/purchases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.MANAGER)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  // ===========================================================================
  // Suppliers Subroutes (Defined first to prevent route shadowing by :idOrPoNumber)
  // ===========================================================================

  @Get('suppliers')
  async listSuppliers(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: SupplierQueryDto,
  ) {
    return this.purchasesService.listSuppliers(storeId, query);
  }

  @Post('suppliers')
  async createSupplier(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: CreateSupplierDto,
  ) {
    return this.purchasesService.createSupplier(storeId, dto);
  }

  @Post('suppliers/:id/pay')
  async recordSupplierPayment(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Param('id') supplierId: string,
    @Body() dto: RecordSupplierPaymentDto,
  ) {
    return this.purchasesService.recordSupplierPayment(
      storeId,
      userId,
      supplierId,
      dto,
    );
  }

  @Get('suppliers/:id/ledger')
  async getSupplierLedger(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') supplierId: string,
  ) {
    return this.purchasesService.getSupplierLedger(storeId, supplierId);
  }

  // ===========================================================================
  // Purchases Endpoints
  // ===========================================================================

  @Get()
  async listPurchaseOrders(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: PurchaseQueryDto,
  ) {
    return this.purchasesService.listPurchaseOrders(storeId, query);
  }

  @Post()
  async createPurchaseOrder(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.purchasesService.createPurchaseOrder(storeId, userId, dto);
  }

  @Get(':idOrPoNumber')
  async getPurchaseOrder(
    @CurrentTenant('storeId') storeId: string,
    @Param('idOrPoNumber') idOrPoNumber: string,
  ) {
    return this.purchasesService.getPurchaseOrderByIdOrPo(
      storeId,
      idOrPoNumber,
    );
  }

  @Post(':idOrPoNumber/receive')
  async receiveStock(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Param('idOrPoNumber') idOrPoNumber: string,
    @Body() dto: ReceiveStockDto,
  ) {
    return this.purchasesService.receiveStock(
      storeId,
      userId,
      idOrPoNumber,
      dto,
    );
  }
}
