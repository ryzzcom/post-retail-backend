import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Body,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { KhataService } from './khata.service';
import { RecordKhataPaymentDto } from './dto/record-khata-payment.dto';
import { AdjustCreditLimitDto } from './dto/adjust-credit-limit.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { IdempotencyInterceptor } from '@core/interceptors/idempotency.interceptor';

@Controller('api/v1/khata')
export class KhataController {
  constructor(private readonly khataService: KhataService) {}

  @Post('payments')
  @UseInterceptors(IdempotencyInterceptor)
  async recordPayment(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: RecordKhataPaymentDto,
  ) {
    return this.khataService.recordPayment(storeId, dto);
  }

  @Patch('credit-limit')
  @Roles(Role.OWNER, Role.MANAGER)
  async adjustCreditLimit(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: AdjustCreditLimitDto,
  ) {
    return this.khataService.adjustCreditLimit(storeId, dto);
  }

  @Get('customer/:customerId')
  async getCustomerLedger(
    @CurrentTenant('storeId') storeId: string,
    @Param('customerId') customerId: string,
    @Query() query?: PaginationQueryDto,
  ) {
    return this.khataService.getCustomerLedger(storeId, customerId, query);
  }

  @Get('debtors')
  async listDebtors(
    @CurrentTenant('storeId') storeId: string,
    @Query() query?: PaginationQueryDto,
  ) {
    return this.khataService.listKhataDebtors(storeId, query);
  }
}
