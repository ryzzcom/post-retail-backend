import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Role } from '@prisma/client';

@Controller('api/v1/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.MANAGER)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * 1. GET /api/v1/reports/overview
   * Unified Overview (Defaults to Sales Tab)
   */
  @Get('overview')
  async getOverview(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getSalesReport(storeId, query);
  }

  /**
   * 2. GET /api/v1/reports/sales
   * Sales & Revenue Tab Report
   */
  @Get('sales')
  async getSalesReport(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getSalesReport(storeId, query);
  }

  /**
   * 3. GET /api/v1/reports/inventory
   * Inventory & Stock Valuation Tab Report
   */
  @Get('inventory')
  async getInventoryReport(@CurrentTenant('storeId') storeId: string) {
    return this.reportsService.getInventoryReport(storeId);
  }

  /**
   * 4. GET /api/v1/reports/finance
   * Finance & P&L Tab Report
   */
  @Get('finance')
  async getFinanceReport(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getFinanceReport(storeId, query);
  }

  /**
   * 5. GET /api/v1/reports/customers
   * Customer & Staff Performance Tab Report
   */
  @Get('customers')
  async getCustomersReport(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getCustomersReport(storeId, query);
  }

  /**
   * 6. GET /api/v1/reports/export
   * Universal CSV Report Download
   */
  @Get('export')
  async exportReport(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: ReportQueryDto,
    @Res() res: Response,
  ) {
    const csvData = await this.reportsService.exportReportCsv(storeId, query);
    const tabName = query.tab || 'sales';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${tabName}-report-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return res.send(csvData);
  }
}
