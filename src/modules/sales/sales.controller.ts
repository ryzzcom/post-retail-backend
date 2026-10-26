import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesHistoryQueryDto } from './dto/sales-history-query.dto';
import {
  CreateSaleReturnDto,
  WhatsappRetryDto,
} from './dto/create-sale-return.dto';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@Controller('api/v1/sales')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  /**
   * 1. GET /api/v1/sales (Paginated Sales List + Top Summary KPIs)
   */
  @Get()
  async getSalesHistory(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: SalesHistoryQueryDto,
  ) {
    return this.salesService.getSalesHistory(storeId, query);
  }

  /**
   * 2. GET /api/v1/sales/:receiptNo (Slide-Over Receipt Detail & Thermal Print Payload)
   */
  @Get(':receiptNo')
  async getReceiptDetail(
    @CurrentTenant('storeId') storeId: string,
    @Param('receiptNo') receiptNo: string,
  ) {
    return this.salesService.getReceiptDetail(storeId, receiptNo);
  }

  /**
   * 3. POST /api/v1/sales/:receiptNo/reprint (Increment Reprint Counter & Log Audit)
   */
  @Post(':receiptNo/reprint')
  @HttpCode(HttpStatus.OK)
  async reprintReceipt(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Param('receiptNo') receiptNo: string,
  ) {
    return this.salesService.reprintReceipt(storeId, receiptNo, userId);
  }

  /**
   * 4. POST /api/v1/sales/:receiptNo/whatsapp-retry (Retry WhatsApp Receipt Dispatch)
   */
  @Post(':receiptNo/whatsapp-retry')
  @HttpCode(HttpStatus.OK)
  async retryWhatsapp(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Param('receiptNo') receiptNo: string,
    @Body() dto: WhatsappRetryDto,
  ) {
    return this.salesService.retryWhatsapp(storeId, receiptNo, userId, dto);
  }

  /**
   * 5. POST /api/v1/sales/:receiptNo/returns (Process Item Return or Exchange)
   */
  @Post(':receiptNo/returns')
  @HttpCode(HttpStatus.OK)
  async processSaleReturn(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Param('receiptNo') receiptNo: string,
    @Body() dto: CreateSaleReturnDto,
  ) {
    return this.salesService.processSaleReturn(storeId, receiptNo, userId, dto);
  }
}
