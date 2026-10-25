import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import {
  DashboardPeriodQueryDto,
  TopVariantsQueryDto,
} from './dto/dashboard-query.dto';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { Role } from '@prisma/client';

@Controller('api/v1/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.MANAGER)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * 1. GET /api/v1/dashboard/sales-profit?period=today|week|mtd
   * Top Hero Card: Net Sales, Profit Breakdown, Payment Split & Revenue Trend Chart
   */
  @Get('sales-profit')
  async getSalesProfit(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: DashboardPeriodQueryDto,
  ) {
    return this.dashboardService.getSalesProfit(storeId, query.period);
  }

  /**
   * 2. GET /api/v1/dashboard/financial-position
   * Live Balance Strip (Point-in-time live snapshot)
   */
  @Get('financial-position')
  async getFinancialPosition(@CurrentTenant('storeId') storeId: string) {
    return this.dashboardService.getFinancialPosition(storeId);
  }

  /**
   * 3. GET /api/v1/dashboard/attention-alerts
   * Actionable Store Alerts ("Needs your attention" Card)
   */
  @Get('attention-alerts')
  async getAttentionAlerts(@CurrentTenant('storeId') storeId: string) {
    return this.dashboardService.getAttentionAlerts(storeId);
  }

  /**
   * 4. GET /api/v1/dashboard/top-variants?period=today|week|mtd&limit=5
   * Top-selling variants table + Customer/Loyalty Header Strip
   */
  @Get('top-variants')
  async getTopVariants(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: TopVariantsQueryDto,
  ) {
    return this.dashboardService.getTopVariants(storeId, query);
  }

  /**
   * 5. GET /api/v1/dashboard/overview?period=today|week|mtd
   * Optional Unified Aggregator Endpoint
   */
  @Get('overview')
  async getOverview(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: DashboardPeriodQueryDto,
  ) {
    return this.dashboardService.getOverview(storeId, query.period);
  }
}
