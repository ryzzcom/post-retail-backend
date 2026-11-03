import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateStoreProfileDto } from './dto/update-store-profile.dto';
import { CreateStaffMemberDto, UpdateStaffMemberDto } from './dto/staff-member.dto';
import {
  UpdateReceiptPrinterDto,
  UpdateSalesStockCreditDto,
} from './dto/update-receipt-printer.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Role } from '@prisma/client';

@Controller('api/v1/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.MANAGER)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * 1. GET /api/v1/settings
   * Complete unified settings payload matching all 5 tabs:
   * storeProfile, teamPermissions, billingSubscription, receiptPrinter, salesStockCredit
   */
  @Get()
  @Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
  async getAllSettings(@CurrentTenant('storeId') storeId: string) {
    return this.settingsService.getAllSettings(storeId);
  }

  /**
   * 2. PATCH /api/v1/settings/store-profile
   * Updates store identity, contact info, operating hours, and NTN/STRN/FBR tax details
   */
  @Patch('store-profile')
  async updateStoreProfile(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: UpdateStoreProfileDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.settingsService.updateStoreProfile(storeId, dto, userId);
  }

  /**
   * 3. Staff & Permissions
   */
  @Get('staff')
  async getStaff(@CurrentTenant('storeId') storeId: string) {
    return this.settingsService.getStaff(storeId);
  }

  @Post('staff')
  async createStaff(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: CreateStaffMemberDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.settingsService.createStaff(storeId, dto, userId);
  }

  @Patch('staff/:id')
  async updateStaff(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') staffId: string,
    @Body() dto: UpdateStaffMemberDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.settingsService.updateStaff(storeId, staffId, dto, userId);
  }

  @Delete('staff/:id')
  async deleteStaff(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') staffId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.settingsService.deleteStaff(storeId, staffId, userId);
  }

  /**
   * 4. PATCH /api/v1/settings/receipt-printer
   * Thermal printer paper size, headers, footers, barcode, and drawer triggers
   */
  @Patch('receipt-printer')
  async updateReceiptPrinter(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: UpdateReceiptPrinterDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.settingsService.updateReceiptPrinter(storeId, dto, userId);
  }

  /**
   * 5. PATCH /api/v1/settings/sales-stock-credit
   * POS sales, inventory thresholds, dead stock warnings, and Khata credit rules
   */
  @Patch('sales-stock-credit')
  async updateSalesStockCredit(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: UpdateSalesStockCreditDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.settingsService.updateSalesStockCredit(storeId, dto, userId);
  }
}
