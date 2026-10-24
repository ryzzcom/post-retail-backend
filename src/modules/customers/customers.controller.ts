import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';

@Controller('api/v1/customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  async createCustomer(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.customersService.createCustomer(storeId, dto);
  }

  @Get()
  async listCustomers(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.customersService.listCustomers(storeId, query);
  }

  @Get(':id')
  async getCustomer(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.customersService.getCustomerById(storeId, id);
  }

  @Patch(':id')
  async updateCustomer(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.updateCustomer(storeId, id, dto);
  }
}
