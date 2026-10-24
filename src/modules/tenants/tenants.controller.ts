import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { UpdateStoreDto } from './dto/update-store.dto';
import { CreateCounterDto } from './dto/create-counter.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('api/v1/tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('store')
  async getStore(@CurrentTenant('storeId') storeId: string) {
    return this.tenantsService.getStore(storeId);
  }

  @Patch('store')
  @Roles(Role.OWNER)
  async updateStore(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: UpdateStoreDto,
  ) {
    return this.tenantsService.updateStore(storeId, dto);
  }

  @Get('counters')
  async listCounters(@CurrentTenant('storeId') storeId: string) {
    return this.tenantsService.listCounters(storeId);
  }

  @Post('counters')
  @Roles(Role.OWNER, Role.MANAGER)
  async createCounter(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: CreateCounterDto,
  ) {
    return this.tenantsService.createCounter(storeId, dto);
  }
}
