import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Headers,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { PosService } from './pos.service';
import { CheckoutDto } from './dto/checkout.dto';
import { HoldBillDto } from './dto/hold-bill.dto';
import { ReturnOrderDto } from './dto/return-order.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { IdempotencyInterceptor } from '@core/interceptors/idempotency.interceptor';

@Controller('api/v1/pos')
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Post('checkout')
  @UseInterceptors(IdempotencyInterceptor)
  async checkout(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') cashierId: string,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @Body() dto: CheckoutDto,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('x-idempotency-key header is required for POS checkout');
    }
    return this.posService.checkout(storeId, cashierId, idempotencyKey, dto);
  }

  @Post('hold')
  async holdBill(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') cashierId: string,
    @Body() dto: HoldBillDto,
  ) {
    return this.posService.holdBill(storeId, cashierId, dto);
  }

  @Get('held-bills')
  async listHeldBills(
    @CurrentTenant('storeId') storeId: string,
  ) {
    return this.posService.listHeldBills(storeId);
  }

  @Patch('held-bills/:id/resume')
  async resumeHeldBill(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.posService.resumeHeldBill(storeId, id);
  }

  @Post('return')
  async returnOrder(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') cashierId: string,
    @Body() dto: ReturnOrderDto,
  ) {
    return this.posService.returnOrder(storeId, cashierId, dto);
  }

  @Get('orders')
  async listOrders(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.posService.listOrders(storeId, query);
  }

  @Get('orders/:id')
  async getOrder(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.posService.getOrderById(storeId, id);
  }
}
