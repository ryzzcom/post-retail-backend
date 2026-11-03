import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Headers,
  UseInterceptors,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { PosService } from './pos.service';
import { CheckoutDto } from './dto/checkout.dto';
import { HoldBillDto } from './dto/hold-bill.dto';
import { ReturnOrderDto } from './dto/return-order.dto';
import { PosProductQueryDto } from './dto/pos-product-query.dto';
import { PosCustomerQueryDto } from './dto/pos-customer-query.dto';
import { QuickCustomerDto } from './dto/quick-customer.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Role } from '@prisma/client';
import { IdempotencyInterceptor } from '@core/interceptors/idempotency.interceptor';

@Controller('api/v1/pos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
export class PosController {
  constructor(private readonly posService: PosService) {}

  /**
   * 1. GET /api/v1/pos/products
   * POS Product Catalog with size/color matrices and instant stock availability
   */
  @Get('products')
  async getProducts(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: PosProductQueryDto,
  ) {
    return this.posService.getPosProducts(storeId, query);
  }

  /**
   * 2. GET /api/v1/pos/customers
   * Search Customer Profiles for POS cart banner
   */
  @Get('customers')
  async getCustomers(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: PosCustomerQueryDto,
  ) {
    return this.posService.getPosCustomers(storeId, query);
  }

  /**
   * 3. POST /api/v1/pos/customers/quick
   * Quick Customer Registration from POS cart or Cashier Shift View
   */
  @Post('customers/quick')
  async quickCreateCustomer(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: QuickCustomerDto,
  ) {
    return this.posService.quickCreateCustomer(storeId, dto);
  }

  /**
   * 4. GET /api/v1/pos/counters
   * List counters for current store
   */
  @Get('counters')
  async getCounters(@CurrentTenant('storeId') storeId: string) {
    return this.posService.getCounters(storeId);
  }

  /**
   * 5. POST /api/v1/pos/checkout
   * Checkout with inventory deductions, financial splits, loyalty & WhatsApp
   */
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

  /**
   * 6. POST /api/v1/pos/held-bills & POST /api/v1/pos/hold
   * Put current cart on hold
   */
  @Post('held-bills')
  async holdBillPlural(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') cashierId: string,
    @Body() dto: HoldBillDto,
  ) {
    return this.posService.holdBill(storeId, cashierId, dto);
  }

  @Post('hold')
  async holdBill(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') cashierId: string,
    @Body() dto: HoldBillDto,
  ) {
    return this.posService.holdBill(storeId, cashierId, dto);
  }

  /**
   * 7. GET /api/v1/pos/held-bills
   * Retrieve active held bills
   */
  @Get('held-bills')
  async listHeldBills(@CurrentTenant('storeId') storeId: string) {
    return this.posService.listHeldBills(storeId);
  }

  /**
   * 8. DELETE /api/v1/pos/held-bills/:id
   * Discard or remove a held bill
   */
  @Delete('held-bills/:id')
  async deleteHeldBill(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.posService.deleteHeldBill(storeId, id);
  }

  /**
   * 9. PATCH /api/v1/pos/held-bills/:id/resume
   * Resume a held bill
   */
  @Patch('held-bills/:id/resume')
  async resumeHeldBill(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.posService.resumeHeldBill(storeId, id);
  }

  /**
   * 10. POST /api/v1/pos/return
   * Process item return/exchange from POS
   */
  @Post('return')
  async returnOrder(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') cashierId: string,
    @Body() dto: ReturnOrderDto,
  ) {
    return this.posService.returnOrder(storeId, cashierId, dto);
  }

  /**
   * 11. GET /api/v1/pos/orders
   * Retrieve POS orders history
   */
  @Get('orders')
  async listOrders(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.posService.listOrders(storeId, query);
  }

  /**
   * 12. GET /api/v1/pos/orders/:id
   * Get single POS order receipt details
   */
  @Get('orders/:id')
  async getOrder(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.posService.getOrderById(storeId, id);
  }
}
