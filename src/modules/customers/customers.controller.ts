import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { AdjustCustomerPointsDto } from './dto/adjust-customer-points.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Role } from '@prisma/client';

@Controller('api/v1/customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  // ---------------------------------------------------------------------------
  // 1. Export CSV (MUST be declared before :id to prevent route shadowing!)
  // ---------------------------------------------------------------------------
  @Get('export')
  async exportCsv(@CurrentTenant('storeId') storeId: string) {
    return this.customersService.exportCsv(storeId);
  }

  // ---------------------------------------------------------------------------
  // 2. Phone Lookup for POS Scanner
  // ---------------------------------------------------------------------------
  @Get('lookup/phone/:phone')
  async searchByPhone(
    @CurrentTenant('storeId') storeId: string,
    @Param('phone') phone: string,
  ) {
    return this.customersService.searchByPhone(storeId, phone);
  }

  // ---------------------------------------------------------------------------
  // 3. Paginated Customers List + Top Summary Strip
  // ---------------------------------------------------------------------------
  @Get()
  async listCustomers(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: CustomerQueryDto,
  ) {
    return this.customersService.listCustomers(storeId, query);
  }

  // ---------------------------------------------------------------------------
  // 4. Create New Customer Profile
  // ---------------------------------------------------------------------------
  @Post()
  async createCustomer(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.customersService.createCustomer(storeId, dto);
  }

  // ---------------------------------------------------------------------------
  // 5. Customer Detail Slide-Over Drawer (Overview & Points Tabs)
  // Strictly resolves by Customer :id
  // ---------------------------------------------------------------------------
  @Get(':id')
  async getCustomer(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.customersService.getCustomerById(storeId, id);
  }

  // ---------------------------------------------------------------------------
  // 6. Update Profile, Style Notes & Communication Toggles
  // Strictly resolves by Customer :id
  // ---------------------------------------------------------------------------
  @Patch(':id')
  async updateCustomer(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.updateCustomer(storeId, id, dto);
  }

  // ---------------------------------------------------------------------------
  // 7. Manual Loyalty Points Adjustment (Credit / Deduction)
  // Strictly resolves by Customer :id
  // ---------------------------------------------------------------------------
  @Post(':id/points/adjust')
  async adjustPoints(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Param('id') customerId: string,
    @Body() dto: AdjustCustomerPointsDto,
  ) {
    return this.customersService.adjustPoints(storeId, userId, customerId, dto);
  }
}
