import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateConnectionSettingsDto } from './dto/update-connection.dto';
import { WhatsAppLogQueryDto } from './dto/whatsapp-query.dto';
import { CreateTemplateDto, SendWhatsAppReceiptDto } from './dto/create-template.dto';
import { formatDate } from '@core/utils/date-time.util';
import { normalizePakistaniPhone } from '@core/utils/phone.util';
import { paisaToRupees } from '@core/utils/currency-paisa.util';
import {
  CustomerTier,
  WhatsappStatus,
  WhatsAppCampaignStatus,
  WhatsAppMessageCategory,
} from '@prisma/client';

@Injectable()
export class WhatsappService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper: Ensure store has WhatsAppConfig initialized
   */
  private async getOrCreateConfig(storeId: string) {
    let config = await this.prisma.whatsAppConfig.findUnique({
      where: { storeId },
    });

    if (!config) {
      const renewalDate = new Date();
      renewalDate.setMonth(renewalDate.getMonth() + 1);

      config = await this.prisma.whatsAppConfig.create({
        data: {
          storeId,
          businessDisplayName: 'Retail Store Support',
          phoneNumberId: '923001234567',
          availableCredits: 1000,
          monthlyAllowance: 1000,
          reservedCredits: 0,
          purchasedCredits: 0,
          nextRenewalDate: renewalDate,
        },
      });
    }

    return config;
  }

  /**
   * 1. GET /api/v1/whatsapp/overview
   * Header metrics, credit usage breakdown, top-up packages, and recent summary
   */
  async getOverview(storeId: string) {
    const config = await this.getOrCreateConfig(storeId);

    const [queuedCount, failedCount, deliveredCount, logs] = await Promise.all([
      this.prisma.whatsAppMessageLog.count({
        where: { storeId, status: WhatsappStatus.PENDING },
      }),
      this.prisma.whatsAppMessageLog.count({
        where: { storeId, status: WhatsappStatus.FAILED },
      }),
      this.prisma.whatsAppMessageLog.count({
        where: { storeId, status: WhatsappStatus.DELIVERED },
      }),
      this.prisma.whatsAppMessageLog.findMany({
        where: { storeId },
        select: { category: true },
      }),
    ]);

    // Compute credit usage breakdown
    let digitalReceipts = 0;
    let khataReminders = 0;
    let promoCampaigns = 0;
    let backInStock = 0;

    for (const log of logs) {
      if (log.category === WhatsAppMessageCategory.DIGITAL_RECEIPT) digitalReceipts++;
      else if (log.category === WhatsAppMessageCategory.KHATA_REMINDER) khataReminders++;
      else if (log.category === WhatsAppMessageCategory.CAMPAIGN) promoCampaigns++;
      else if (log.category === WhatsAppMessageCategory.BACK_IN_STOCK) backInStock++;
    }

    const creditPacks = [
      { id: 'pack-starter', name: 'Starter Pack', credits: 1000, pricePKR: 1500 },
      { id: 'pack-growth', name: 'Growth Pack', credits: 5000, pricePKR: 6500, featured: true },
      { id: 'pack-enterprise', name: 'Enterprise Pack', credits: 20000, pricePKR: 22000 },
    ];

    const nextRenewalDate = config.nextRenewalDate
      ? formatDate(config.nextRenewalDate)
      : '1st of next month';

    return {
      metrics: {
        connectedStatus: config.isApiEnabled ? 'Connected' : 'Disconnected',
        queuedCount,
        failedCount,
        deliveredCount,
        availableCredits: config.availableCredits,
        monthlyAllowance: config.monthlyAllowance,
        reservedCredits: config.reservedCredits,
        purchasedCredits: config.purchasedCredits,
        nextRenewalDate,
      },
      creditUsage: {
        digitalReceipts,
        khataReminders,
        promoCampaigns,
        backInStock,
      },
      creditPacks,
    };
  }

  /**
   * 2. GET /api/v1/whatsapp/campaigns
   * List broadcast campaigns with redemption stats
   */
  async getCampaigns(storeId: string) {
    const campaigns = await this.prisma.whatsAppCampaign.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });

    return campaigns.map((c) => ({
      id: c.id,
      title: c.title,
      purpose: c.purpose,
      couponCode: c.couponCode || 'N/A',
      discount: c.discount || 'Special Offer',
      validity: c.validity || 'Limited Time',
      messagesSent: c.messagesSent,
      posRedeemed: c.posRedeemed,
      status:
        c.status === WhatsAppCampaignStatus.ACTIVE
          ? 'Active'
          : c.status === WhatsAppCampaignStatus.COMPLETED
            ? 'Completed'
            : c.status === WhatsAppCampaignStatus.SCHEDULED
              ? 'Scheduled'
              : 'Draft',
      audienceSegment: c.audienceSegment,
      templateName: c.templateName,
      revenueAttributedPKR: paisaToRupees(c.revenueAttributed),
      createdAt: formatDate(c.createdAt),
    }));
  }

  /**
   * 3. POST /api/v1/whatsapp/campaigns
   * Launch or schedule broadcast campaign with audience segmentation
   */
  async createCampaign(storeId: string, dto: CreateCampaignDto, userId?: string) {
    const config = await this.getOrCreateConfig(storeId);

    // Dynamic audience count evaluation from Customer profiles
    let audienceWhere: any = { storeId, isActive: true, whatsappReceiptsOptIn: true };

    const seg = dto.audienceSegment.toLowerCase();
    if (seg.includes('gold')) {
      audienceWhere.tier = CustomerTier.GOLD;
    } else if (seg.includes('silver')) {
      audienceWhere.tier = CustomerTier.SILVER;
    } else if (seg.includes('inactive') || seg.includes('60')) {
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      audienceWhere.lastVisitAt = { lte: sixtyDaysAgo };
    }

    const eligibleCustomerCount = await this.prisma.customer.count({
      where: audienceWhere,
    });

    const messagesToSend = Math.max(1, eligibleCustomerCount);
    if (config.availableCredits < messagesToSend) {
      throw new BadRequestException(
        `Insufficient WhatsApp credits! Required: ${messagesToSend}, Available: ${config.availableCredits}. Please top up your credits.`,
      );
    }

    const isScheduled = dto.scheduleType?.toLowerCase() === 'scheduled';
    const status = isScheduled
      ? WhatsAppCampaignStatus.SCHEDULED
      : WhatsAppCampaignStatus.ACTIVE;

    const campaign = await this.prisma.$transaction(async (tx) => {
      const created = await tx.whatsAppCampaign.create({
        data: {
          storeId,
          title: dto.title,
          purpose: dto.purpose,
          audienceSegment: dto.audienceSegment,
          couponCode: dto.couponCode || null,
          discount: dto.discount || null,
          validity: dto.validity || null,
          templateName: dto.templateName || 'Seasonal Promotion',
          templateId: dto.templateId || null,
          messagesSent: isScheduled ? 0 : messagesToSend,
          status,
          scheduledAt: dto.scheduledDate ? new Date(dto.scheduledDate) : null,
          sentAt: isScheduled ? null : new Date(),
        },
      });

      // Deduct credits
      if (!isScheduled) {
        await tx.whatsAppConfig.update({
          where: { storeId },
          data: {
            availableCredits: { decrement: messagesToSend },
          },
        });

        // Add a message log entry
        await tx.whatsAppMessageLog.create({
          data: {
            storeId,
            customerName: `Segment: ${dto.audienceSegment}`,
            customerPhone: 'Broadcast',
            templateName: created.templateName,
            message: `Campaign: ${created.title} - ${created.purpose}`,
            status: WhatsappStatus.DELIVERED,
            category: WhatsAppMessageCategory.CAMPAIGN,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          storeId,
          userId: userId || null,
          action: 'WHATSAPP_CAMPAIGN_CREATED',
          entity: 'WhatsAppCampaign',
          entityId: created.id,
          details: {
            title: created.title,
            audienceSegment: created.audienceSegment,
            messagesSent: isScheduled ? 0 : messagesToSend,
            status,
          },
        },
      });

      return created;
    });

    return {
      id: campaign.id,
      title: campaign.title,
      audienceSegment: campaign.audienceSegment,
      messagesSent: campaign.messagesSent,
      status: campaign.status,
      scheduledDate: campaign.scheduledAt?.toISOString() || null,
      createdAt: campaign.createdAt.toISOString(),
    };
  }

  /**
   * 4. GET /api/v1/whatsapp/templates
   * Standard templates catalog
   */
  async getTemplates(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });
    const storeName = store?.name || 'Retail Boutique';

    return [
      {
        id: 'tmpl-receipt',
        name: 'Digital POS Thermal Receipt',
        category: 'Digital receipt',
        metaCategory: 'Utility',
        body: `Assalam-o-Alaikum {{customer_name}}, thank you for shopping at ${storeName}! Your e-receipt for Rs. {{amount}} is ready to view: {{receipt_link}}`,
        variables: ['customer_name', 'amount', 'receipt_link'],
        language: 'English / Urdu',
        status: 'Approved',
      },
      {
        id: 'tmpl-khata-reminder',
        name: 'Polite Khata Udhaar Reminder',
        category: 'Khata reminder',
        metaCategory: 'Utility',
        body: `Dear {{customer_name}}, this is a friendly reminder that your Khata balance of Rs. {{balance}} at ${storeName} is due. Please settle via Cash or Bank transfer: {{payment_link}}`,
        variables: ['customer_name', 'balance', 'payment_link'],
        language: 'English',
        status: 'Approved',
      },
      {
        id: 'tmpl-loyalty-bonus',
        name: 'VIP Tier Welcome Bonus',
        category: 'Loyalty update',
        metaCategory: 'Utility',
        body: `Congratulations {{customer_name}}! You have been upgraded to {{tier_name}} Tier at ${storeName}. You have {{points}} points ready to redeem on your next visit!`,
        variables: ['customer_name', 'tier_name', 'points'],
        language: 'English',
        status: 'Approved',
      },
      {
        id: 'tmpl-new-arrivals',
        name: 'New Season Arrivals',
        category: 'New arrivals',
        metaCategory: 'Marketing',
        body: `Hello {{customer_name}}, the latest seasonal fabrics and apparel collection has just landed at ${storeName}! Enjoy an exclusive {{discount}} discount with code {{coupon_code}}.`,
        variables: ['customer_name', 'discount', 'coupon_code'],
        language: 'English',
        status: 'Approved',
      },
      {
        id: 'tmpl-review-request',
        name: 'Google Rating & Feedback',
        category: 'Review request',
        metaCategory: 'Marketing',
        body: `How was your experience shopping at ${storeName}? Please take 30 seconds to rate us on Google: {{review_link}}`,
        variables: ['review_link'],
        language: 'English',
        status: 'Approved',
      },
    ];
  }

  /**
   * 5. GET /api/v1/whatsapp/automations
   * Automated Message Rules & Triggers
   */
  async getAutomatedRules(storeId: string) {
    let rules = await this.prisma.whatsAppAutomationRule.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
    });

    if (rules.length === 0) {
      const defaultRules = [
        {
          storeId,
          title: 'Digital POS Thermal Receipt',
          timing: 'Instant',
          trigger: 'On checkout completion',
          templateName: 'Digital POS Thermal Receipt',
          enabled: true,
        },
        {
          storeId,
          title: 'Khata Payment Reminder',
          timing: 'Daily at 10:00 AM',
          trigger: 'When bill exceeds terms (30d)',
          templateName: 'Polite Khata Udhaar Reminder',
          enabled: true,
        },
        {
          storeId,
          title: 'VIP Tier Upgrade Notification',
          timing: 'Instant',
          trigger: 'When customer reaches Gold/Silver tier',
          templateName: 'VIP Tier Welcome Bonus',
          enabled: true,
        },
        {
          storeId,
          title: 'Customer Win-Back Alert',
          timing: 'After 60 days',
          trigger: 'No purchase in past 60 days',
          templateName: 'New Season Arrivals',
          enabled: false,
        },
      ];

      await this.prisma.whatsAppAutomationRule.createMany({
        data: defaultRules,
      });

      rules = await this.prisma.whatsAppAutomationRule.findMany({
        where: { storeId },
        orderBy: { createdAt: 'asc' },
      });
    }

    return rules.map((r) => ({
      id: r.id,
      title: r.title,
      timing: r.timing,
      trigger: r.trigger,
      templateName: r.templateName,
      lastRun: r.lastRun ? formatDate(r.lastRun) : 'Today',
      enabled: r.enabled,
    }));
  }

  /**
   * 6. PATCH /api/v1/whatsapp/automations/:id/toggle
   * Toggle automated rule
   */
  async toggleAutomatedRule(storeId: string, id: string, enabled?: boolean) {
    const rule = await this.prisma.whatsAppAutomationRule.findFirst({
      where: { id, storeId },
    });

    if (!rule) {
      throw new NotFoundException(`Automation rule ${id} not found`);
    }

    const newEnabled = enabled !== undefined ? enabled : !rule.enabled;

    const updated = await this.prisma.whatsAppAutomationRule.update({
      where: { id: rule.id },
      data: { enabled: newEnabled },
    });

    return {
      id: updated.id,
      title: updated.title,
      enabled: updated.enabled,
    };
  }

  /**
   * 7. GET /api/v1/whatsapp/connection
   * Get Meta Business API connection and consent configuration
   */
  async getConnectionSettings(storeId: string) {
    const config = await this.getOrCreateConfig(storeId);

    return {
      phoneNumberId: config.phoneNumberId || '923001234567',
      businessDisplayName: config.businessDisplayName || 'Retail Store Support',
      googleReviewLink: config.googleReviewLink || 'https://g.page/r/example',
      isApiEnabled: config.isApiEnabled,
      requireExplicitOptIn: config.requireExplicitOptIn,
      enforceQuietHours: config.enforceQuietHours,
      autoUnsubscribeKeyword: config.autoUnsubscribeKeyword,
    };
  }

  /**
   * 8. PATCH /api/v1/whatsapp/connection
   * Update Meta connection and consent settings
   */
  async updateConnectionSettings(storeId: string, dto: UpdateConnectionSettingsDto) {
    await this.getOrCreateConfig(storeId);

    const updated = await this.prisma.whatsAppConfig.update({
      where: { storeId },
      data: {
        ...(dto.phoneNumberId !== undefined ? { phoneNumberId: dto.phoneNumberId } : {}),
        ...(dto.businessDisplayName !== undefined ? { businessDisplayName: dto.businessDisplayName } : {}),
        ...(dto.googleReviewLink !== undefined ? { googleReviewLink: dto.googleReviewLink } : {}),
        ...(dto.isApiEnabled !== undefined ? { isApiEnabled: dto.isApiEnabled } : {}),
        ...(dto.requireExplicitOptIn !== undefined ? { requireExplicitOptIn: dto.requireExplicitOptIn } : {}),
        ...(dto.enforceQuietHours !== undefined ? { enforceQuietHours: dto.enforceQuietHours } : {}),
        ...(dto.autoUnsubscribeKeyword !== undefined ? { autoUnsubscribeKeyword: dto.autoUnsubscribeKeyword } : {}),
      },
    });

    return {
      phoneNumberId: updated.phoneNumberId,
      businessDisplayName: updated.businessDisplayName,
      isApiEnabled: updated.isApiEnabled,
      requireExplicitOptIn: updated.requireExplicitOptIn,
      enforceQuietHours: updated.enforceQuietHours,
      autoUnsubscribeKeyword: updated.autoUnsubscribeKeyword,
    };
  }

  /**
   * 9. GET /api/v1/whatsapp/logs
   * Delivery logs table with status pills, search, and resend action
   */
  async getMessageLogs(storeId: string, query: WhatsAppLogQueryDto) {
    const where: any = { storeId };

    if (query.status && query.status.toLowerCase() !== 'all') {
      const s = query.status.toUpperCase();
      if (s === 'SENT') where.status = WhatsappStatus.SENT;
      else if (s === 'DELIVERED') where.status = WhatsappStatus.DELIVERED;
      else if (s === 'FAILED') where.status = WhatsappStatus.FAILED;
    }

    if (query.search && query.search.trim()) {
      const q = query.search.trim();
      where.OR = [
        { customerName: { contains: q, mode: 'insensitive' } },
        { customerPhone: { contains: q, mode: 'insensitive' } },
        { receiptRef: { contains: q, mode: 'insensitive' } },
        { message: { contains: q, mode: 'insensitive' } },
      ];
    }

    const limit = query.limit || 20;
    const page = query.page || 1;
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.prisma.whatsAppMessageLog.count({ where }),
      this.prisma.whatsAppMessageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const formattedItems = items.map((l) => ({
      id: l.id,
      customerName: l.customerName,
      customerPhone: l.customerPhone,
      receiptRef: l.receiptRef || 'N/A',
      templateName: l.templateName,
      message: l.message,
      status: l.status.toLowerCase() as 'delivered' | 'failed' | 'sent' | 'read',
      updatedAt: formatDate(l.updatedAt),
      failureReason: l.failureReason || undefined,
      category:
        l.category === WhatsAppMessageCategory.DIGITAL_RECEIPT
          ? 'Digital receipt'
          : l.category === WhatsAppMessageCategory.KHATA_REMINDER
            ? 'Khata reminder'
            : l.category === WhatsAppMessageCategory.CAMPAIGN
              ? 'Campaign'
              : l.category === WhatsAppMessageCategory.BACK_IN_STOCK
                ? 'Back in stock'
                : 'Review',
    }));

    return {
      items: formattedItems,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 10. POST /api/v1/whatsapp/logs/:id/resend
   * Resend failed WhatsApp receipt / message
   */
  async resendMessage(storeId: string, id: string) {
    const log = await this.prisma.whatsAppMessageLog.findFirst({
      where: { id, storeId },
    });

    if (!log) {
      throw new NotFoundException(`Message log ${id} not found`);
    }

    const updated = await this.prisma.whatsAppMessageLog.update({
      where: { id: log.id },
      data: {
        status: WhatsappStatus.DELIVERED,
        failureReason: null,
      },
    });

    return {
      success: true,
      id: updated.id,
      customerName: updated.customerName,
      customerPhone: updated.customerPhone,
      status: 'delivered',
      resendAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * 11. POST /api/v1/whatsapp/send-receipt
   * Send thermal receipt on WhatsApp
   */
  async sendReceipt(storeId: string, dto: SendWhatsAppReceiptDto) {
    const config = await this.getOrCreateConfig(storeId);
    if (config.availableCredits < 1) {
      throw new BadRequestException('Insufficient WhatsApp credits to dispatch receipt');
    }

    const log = await this.prisma.whatsAppMessageLog.create({
      data: {
        storeId,
        customerName: dto.customerName,
        customerPhone: normalizePakistaniPhone(dto.phone),
        receiptRef: dto.receiptNo,
        templateName: 'Digital POS Thermal Receipt',
        message: `Your thermal receipt #${dto.receiptNo} from our store is ready.`,
        status: WhatsappStatus.DELIVERED,
        category: WhatsAppMessageCategory.DIGITAL_RECEIPT,
      },
    });

    await this.prisma.whatsAppConfig.update({
      where: { storeId },
      data: {
        availableCredits: { decrement: 1 },
      },
    });

    return {
      success: true,
      messageId: log.id,
      receiptNo: dto.receiptNo,
      phone: dto.phone,
      sentAt: log.createdAt.toISOString(),
    };
  }
}
