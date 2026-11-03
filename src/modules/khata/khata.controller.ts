import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { KhataService } from './khata.service';
import { RecordKhataPaymentDto } from './dto/record-khata-payment.dto';
import { AdjustCreditLimitDto } from './dto/adjust-credit-limit.dto';
import { WhatsAppReminderDto } from './dto/whatsapp-reminder.dto';
import { KhataQueryDto } from './dto/khata-query.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Role } from '@prisma/client';
import { IdempotencyInterceptor } from '@core/interceptors/idempotency.interceptor';

@Controller('api/v1/khata')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
export class KhataController {
  constructor(private readonly khataService: KhataService) {}

  /**
   * 1. GET /api/v1/khata/accounts
   * Paginated Khata directory with aging cards, filters, and cashier strip
   */
  @Get('accounts')
  async listKhataAccounts(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: KhataQueryDto,
  ) {
    return this.khataService.getKhataOverview(storeId, query);
  }

  // Alias for backward compatibility
  @Get('debtors')
  async listDebtors(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: KhataQueryDto,
  ) {
    return this.khataService.getKhataOverview(storeId, query);
  }

  /**
   * 2. GET /api/v1/khata/export
   * Universal CSV Export (Must be declared before :customerId route)
   */
  @Get('export')
  async exportKhata(
    @CurrentTenant('storeId') storeId: string,
    @Res() res: Response,
  ) {
    const csvData = await this.khataService.exportKhataCsv(storeId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="khata-accounts-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return res.send(csvData);
  }

  /**
   * 3. GET /api/v1/khata/:customerId/ledger
   * Slide-Over Detail Drawer with chronological history
   */
  @Get(':customerId/ledger')
  async getCustomerLedger(
    @CurrentTenant('storeId') storeId: string,
    @Param('customerId') customerId: string,
    @Query() query?: PaginationQueryDto,
  ) {
    return this.khataService.getCustomerLedger(storeId, customerId, query);
  }

  // Alias for backward compatibility
  @Get('customer/:customerId')
  async getCustomerLedgerLegacy(
    @CurrentTenant('storeId') storeId: string,
    @Param('customerId') customerId: string,
    @Query() query?: PaginationQueryDto,
  ) {
    return this.khataService.getCustomerLedger(storeId, customerId, query);
  }

  /**
   * 4. POST /api/v1/khata/payments
   * Record payment against Khata account
   */
  @Post('payments')
  @UseInterceptors(IdempotencyInterceptor)
  async recordPayment(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') cashierId: string,
    @Body() dto: RecordKhataPaymentDto,
  ) {
    return this.khataService.recordPayment(storeId, dto, cashierId);
  }

  // Static alias for backward compatibility (must precede parameterized route)
  @Patch('credit-limit')
  @Roles(Role.OWNER, Role.MANAGER)
  async adjustCreditLimitLegacy(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AdjustCreditLimitDto,
  ) {
    return this.khataService.adjustCreditLimit(storeId, dto.customerId || dto.accountId || '', dto, userId);
  }

  /**
   * 5. PATCH /api/v1/khata/:customerId/credit-limit
   * Adjust customer credit limit (Owner & Manager only)
   */
  @Patch(':customerId/credit-limit')
  @Roles(Role.OWNER, Role.MANAGER)
  async adjustCreditLimit(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Param('customerId') customerId: string,
    @Body() dto: AdjustCreditLimitDto,
  ) {
    return this.khataService.adjustCreditLimit(storeId, customerId, dto, userId);
  }

  /**
   * 6. POST /api/v1/khata/:customerId/remind
   * Dispatch polite WhatsApp payment reminder
   */
  @Post(':customerId/remind')
  async sendReminder(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Param('customerId') customerId: string,
    @Body() dto: WhatsAppReminderDto,
  ) {
    return this.khataService.sendPaymentReminder(storeId, customerId, dto, userId);
  }
}
