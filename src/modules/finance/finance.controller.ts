import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FinanceService } from './finance.service';
import { ExpenseQueryDto } from './dto/expense-query.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { PayExpenseDto } from './dto/pay-expense.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Role } from '@prisma/client';

@Controller('api/v1/finance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.MANAGER)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  // ---------------------------------------------------------------------------
  // 1. Get Expenses: Summary Cards, Where It Went, Bills To Pay & Entries Table
  // ---------------------------------------------------------------------------
  @Get('expenses')
  async listExpenses(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: ExpenseQueryDto,
  ) {
    return this.financeService.listExpenses(storeId, query);
  }

  // ---------------------------------------------------------------------------
  // 2. Add New Expense Modal
  // ---------------------------------------------------------------------------
  @Post('expenses')
  async createExpense(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.financeService.createExpense(storeId, userId, dto);
  }

  // ---------------------------------------------------------------------------
  // 3. Record Payment on Unpaid / Partial Bill
  // ---------------------------------------------------------------------------
  @Post('expenses/:id/pay')
  async payExpense(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: PayExpenseDto,
  ) {
    return this.financeService.payExpense(storeId, userId, id, dto);
  }

  // ---------------------------------------------------------------------------
  // 4. Paginated Audit Logs
  // ---------------------------------------------------------------------------
  @Get('audit-logs')
  @Roles(Role.OWNER)
  async listAuditLogs(
    @CurrentTenant('storeId') storeId: string,
    @Query() query?: PaginationQueryDto,
  ) {
    return this.financeService.listAuditLogs(storeId, query);
  }
}
