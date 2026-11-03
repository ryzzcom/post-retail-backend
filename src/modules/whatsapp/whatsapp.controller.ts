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
import { WhatsappService } from './whatsapp.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateConnectionSettingsDto } from './dto/update-connection.dto';
import { WhatsAppLogQueryDto } from './dto/whatsapp-query.dto';
import { SendWhatsAppReceiptDto } from './dto/create-template.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Role } from '@prisma/client';

@Controller('api/v1/whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.MANAGER)
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  /**
   * 1. GET /api/v1/whatsapp/overview
   * Header metrics, credits balance, and breakdown
   */
  @Get('overview')
  async getOverview(@CurrentTenant('storeId') storeId: string) {
    return this.whatsappService.getOverview(storeId);
  }

  /**
   * 2. GET /api/v1/whatsapp/campaigns
   * List broadcast campaigns
   */
  @Get('campaigns')
  async listCampaigns(@CurrentTenant('storeId') storeId: string) {
    return this.whatsappService.getCampaigns(storeId);
  }

  /**
   * 3. POST /api/v1/whatsapp/campaigns
   * Launch new broadcast campaign
   */
  @Post('campaigns')
  async createCampaign(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.whatsappService.createCampaign(storeId, dto, userId);
  }

  /**
   * 4. GET /api/v1/whatsapp/templates
   * List approved template catalog
   */
  @Get('templates')
  async listTemplates(@CurrentTenant('storeId') storeId: string) {
    return this.whatsappService.getTemplates(storeId);
  }

  /**
   * 5. GET /api/v1/whatsapp/automations
   * List automated message rules
   */
  @Get('automations')
  async listAutomations(@CurrentTenant('storeId') storeId: string) {
    return this.whatsappService.getAutomatedRules(storeId);
  }

  /**
   * 6. PATCH /api/v1/whatsapp/automations/:id/toggle
   * Toggle automated rule
   */
  @Patch('automations/:id/toggle')
  async toggleAutomation(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
    @Body('enabled') enabled?: boolean,
  ) {
    return this.whatsappService.toggleAutomatedRule(storeId, id, enabled);
  }

  /**
   * 7. GET /api/v1/whatsapp/connection
   * Connection & consent config
   */
  @Get('connection')
  async getConnection(@CurrentTenant('storeId') storeId: string) {
    return this.whatsappService.getConnectionSettings(storeId);
  }

  /**
   * 8. PATCH /api/v1/whatsapp/connection
   * Update Meta credentials & consent settings
   */
  @Patch('connection')
  async updateConnection(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: UpdateConnectionSettingsDto,
  ) {
    return this.whatsappService.updateConnectionSettings(storeId, dto);
  }

  /**
   * 9. GET /api/v1/whatsapp/logs
   * Delivery logs with filters
   */
  @Get('logs')
  async listLogs(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: WhatsAppLogQueryDto,
  ) {
    return this.whatsappService.getMessageLogs(storeId, query);
  }

  /**
   * 10. POST /api/v1/whatsapp/logs/:id/resend
   * Retry failed message
   */
  @Post('logs/:id/resend')
  async resendMessage(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.whatsappService.resendMessage(storeId, id);
  }

  /**
   * 11. POST /api/v1/whatsapp/send-receipt
   * Send digital thermal receipt on WhatsApp
   */
  @Post('send-receipt')
  @Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
  async sendReceipt(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: SendWhatsAppReceiptDto,
  ) {
    return this.whatsappService.sendReceipt(storeId, dto);
  }
}
