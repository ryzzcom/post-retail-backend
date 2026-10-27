import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { UpdateLoyaltyRulesDto } from './dto/update-loyalty-rules.dto';
import { CouponQueryDto } from './dto/coupon-query.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ValidatePosCartDto } from './dto/validate-pos-cart.dto';
import { LoyaltyLedgerQueryDto } from './dto/loyalty-ledger-query.dto';
import { CreateReferralDto } from './dto/create-referral.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Role } from '@prisma/client';

@Controller('api/v1/loyalty')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  // ===========================================================================
  // 0. Top Summary Header Strip
  // ===========================================================================
  @Get('summary')
  async getProgramSummary(@CurrentTenant('storeId') storeId: string) {
    return this.loyaltyService.getProgramSummary(storeId);
  }

  // ===========================================================================
  // 1. Point Rules (Tab 1)
  // ===========================================================================
  @Get('rules')
  async getRules(@CurrentTenant('storeId') storeId: string) {
    return this.loyaltyService.getRules(storeId);
  }

  @Put('rules')
  async updateRulesPut(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: UpdateLoyaltyRulesDto,
  ) {
    return this.loyaltyService.updateRules(storeId, dto);
  }

  @Patch('rules')
  async updateRulesPatch(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: UpdateLoyaltyRulesDto,
  ) {
    return this.loyaltyService.updateRules(storeId, dto);
  }

  // ===========================================================================
  // 2. Coupons (Tab 2)
  // Note: 'coupons/validate' must precede 'coupons/:id' to prevent route shadowing
  // ===========================================================================
  @Post('coupons/validate')
  async validatePosCart(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: ValidatePosCartDto,
  ) {
    return this.loyaltyService.validatePosCart(storeId, dto);
  }

  @Get('coupons')
  async listCoupons(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: CouponQueryDto,
  ) {
    return this.loyaltyService.listCoupons(storeId, query);
  }

  @Post('coupons')
  async createCoupon(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: CreateCouponDto,
  ) {
    return this.loyaltyService.createCoupon(storeId, dto);
  }

  @Patch('coupons/:id')
  async updateCoupon(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.loyaltyService.updateCoupon(storeId, id, dto);
  }

  // ===========================================================================
  // 3. Referrals & Ledger (Tab 3)
  // Note: 'ledger/export' must precede any dynamic :id
  // ===========================================================================
  @Get('ledger/export')
  async exportLedgerCsv(@CurrentTenant('storeId') storeId: string) {
    return this.loyaltyService.exportLedgerCsv(storeId);
  }

  @Get('ledger')
  async listLedger(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: LoyaltyLedgerQueryDto,
  ) {
    return this.loyaltyService.listLedger(storeId, query);
  }

  @Post('referrals')
  async recordReferral(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateReferralDto,
  ) {
    return this.loyaltyService.recordReferral(storeId, userId, dto);
  }
}
