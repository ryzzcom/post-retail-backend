import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { CashMovementDto } from './dto/cash-movement.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Role } from '@prisma/client';

@Controller('api/v1/shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post('open')
  async openShift(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') cashierId: string,
    @Body() dto: OpenShiftDto,
  ) {
    return this.shiftsService.openShift(storeId, cashierId, dto);
  }

  @Get('current')
  async getCurrentShift(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') cashierId: string,
  ) {
    return this.shiftsService.getCurrentShift(storeId, cashierId);
  }

  @Post('cash-movement')
  async recordCashMovement(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') cashierId: string,
    @Body() dto: CashMovementDto,
  ) {
    return this.shiftsService.recordCashMovement(storeId, cashierId, dto);
  }

  @Post(':id/close')
  async closeShift(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') shiftId: string,
    @CurrentUser('id') cashierId: string,
    @Body() dto: CloseShiftDto,
  ) {
    return this.shiftsService.closeShift(storeId, shiftId, cashierId, dto);
  }

  @Get()
  async listShifts(
    @CurrentTenant('storeId') storeId: string,
    @Query() query?: PaginationQueryDto,
  ) {
    return this.shiftsService.listShifts(storeId, query);
  }
}
