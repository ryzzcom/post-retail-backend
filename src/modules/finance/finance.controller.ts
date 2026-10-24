import {
  Controller,
  Post,
  Get,
  Body,
  Query,
} from '@nestjs/common';
import { FinanceService } from './finance.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('api/v1/finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Post('expenses')
  @Roles(Role.OWNER, Role.MANAGER)
  async createExpense(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.financeService.createExpense(storeId, userId, dto);
  }

  @Get('expenses')
  async listExpenses(
    @CurrentTenant('storeId') storeId: string,
    @Query() query?: PaginationQueryDto,
  ) {
    return this.financeService.listExpenses(storeId, query);
  }

  @Get('audit-logs')
  @Roles(Role.OWNER)
  async listAuditLogs(
    @CurrentTenant('storeId') storeId: string,
    @Query() query?: PaginationQueryDto,
  ) {
    return this.financeService.listAuditLogs(storeId, query);
  }
}
