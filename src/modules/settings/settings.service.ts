import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@database/prisma.service';
import { UpdateStoreProfileDto } from './dto/update-store-profile.dto';
import { CreateStaffMemberDto, UpdateStaffMemberDto } from './dto/staff-member.dto';
import { UpdateReceiptPrinterDto, UpdateSalesStockCreditDto } from './dto/update-receipt-printer.dto';
import { paisaToRupees, rupeesToPaisa } from '@core/utils/currency-paisa.util';
import { formatDate } from '@core/utils/date-time.util';
import { normalizePakistaniPhone } from '@core/utils/phone.util';
import { Role } from '@prisma/client';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper: Map internal Role enum to frontend StaffRole string
   */
  private mapRoleToFrontend(role: Role): 'owner' | 'manager' | 'cashier' | 'inventory_clerk' {
    if (role === Role.OWNER) return 'owner';
    if (role === Role.MANAGER) return 'manager';
    return 'cashier';
  }

  private mapFrontendToRole(roleStr: string): Role {
    const r = roleStr.toUpperCase();
    if (r === 'OWNER') return Role.OWNER;
    if (r === 'MANAGER') return Role.MANAGER;
    return Role.CASHIER;
  }

  /**
   * 1. GET /api/v1/settings
   * Complete unified settings payload matching all 5 tabs
   */
  async getAllSettings(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });

    if (!store) {
      throw new NotFoundException(`Store ${storeId} not found`);
    }

    const [staffUsers, countersCount, productsCount, ordersCount] = await Promise.all([
      this.prisma.user.findMany({
        where: { storeId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.counter.count({ where: { storeId } }),
      this.prisma.product.count({ where: { storeId } }),
      this.prisma.order.count({ where: { storeId } }),
    ]);

    // 1. Store Profile
    const storeProfile = {
      storeName: store.name,
      branchCode: store.code,
      tagline: store.tagline || 'High-End Retail & Boutiques',
      storeCategory: store.storeCategory || 'Apparel & Fabrics Boutique',
      primaryPhone: store.phone || '0300-1234567',
      whatsappNumber: store.whatsappNumber || store.phone || '0300-1234567',
      officialEmail: store.officialEmail || 'support@retailstore.pk',
      streetAddress: store.address || 'Shop # 14, Main Boulevard, Gulberg III',
      areaMarket: store.areaMarket || 'Gulberg III Commercial Area',
      city: store.city || 'Lahore',
      currency: store.currency || 'PKR',
      timezone: store.timezone || 'Asia/Karachi',
      operatingHours: store.operatingHours || '11:00 AM - 10:00 PM (Mon-Sun)',
      ntnNumber: store.ntn || '9182374-1',
      strnNumber: store.strn || '32-77-8761-231-19',
      fbrIntegrationEnabled: store.fbrIntegrationEnabled,
      posRegistrationId: store.posRegistrationId || 'FBR-POS-98124',
      defaultGstRate: store.defaultGstRate ? `${store.defaultGstRate}%` : '0%',
    };

    // 2. Team & Permissions
    const staffMembers = staffUsers.map((u) => ({
      id: u.id,
      name: u.fullName,
      email: u.email,
      phone: u.phone || '0300-1234567',
      role: this.mapRoleToFrontend(u.role),
      assignedTerminal: u.assignedTerminal || 'All Counters',
      pinSet: !!(u.pinHash || u.otpCode),
      lastActive: formatDate(u.updatedAt),
      status: u.isActive ? ('active' as const) : ('suspended' as const),
      maxDiscountPercent: u.maxDiscountPercent || 10,
    }));

    const rolePermissions = {
      allowManualDiscount: true,
      maxCashierDiscountPercent: store.maxDiscountWithoutManagerPin,
      processReturnsWithoutPin: false,
      viewCostAndMargins: false,
      openDrawerWithoutSale: false,
      editKhataCreditLimit: false,
    };

    // 3. Billing & Subscription
    const billingPlan = {
      name: 'POS Retail Enterprise Pro',
      interval: 'Annual' as const,
      price: 45000,
      renewalDate: 'Nov 12, 2027',
      activeRegisters: `${countersCount} / 5 Registers`,
      whatsappCredits: '1,000 / 1,000 Credits',
    };

    const usageMetrics = [
      {
        id: 'metric-registers',
        label: 'Active POS Counters',
        used: countersCount || 1,
        limit: 5,
        unit: 'counters',
        percentage: Math.min(100, Math.round(((countersCount || 1) / 5) * 100)),
      },
      {
        id: 'metric-products',
        label: 'Active SKUs & Catalog Items',
        used: productsCount,
        limit: 10000,
        unit: 'products',
        percentage: Math.min(100, Math.round((productsCount / 10000) * 100)),
      },
      {
        id: 'metric-orders',
        label: 'Monthly Orders Volume',
        used: ordersCount,
        limit: 50000,
        unit: 'receipts',
        percentage: Math.min(100, Math.round((ordersCount / 50000) * 100)),
      },
    ];

    const savedPaymentMethods = [
      {
        id: 'pm-1',
        type: 'bank' as const,
        title: 'Meezan Bank Commercial Account',
        subtitle: 'IBAN: PK82MEZN0001928374819201',
        expiry: 'Active',
        isDefault: true,
      },
      {
        id: 'pm-2',
        type: 'card' as const,
        title: 'Visa Corporate Debit Card',
        subtitle: 'Ending in **** 8192',
        expiry: '12/28',
        isDefault: false,
      },
    ];

    const billingInvoices = [
      {
        id: 'inv-1',
        invoiceNumber: 'INV-2026-0041',
        date: 'Oct 12, 2026',
        description: 'POS Retail Enterprise Annual Subscription',
        amount: 45000,
        status: 'paid' as const,
      },
    ];

    // 4. Receipt & Printer
    const receiptPrinter = {
      paperSize: (store.paperSize as any) || '80mm',
      autoPrintReceipt: store.autoPrintReceipt,
      openDrawerOnCash: store.openDrawerOnCash,
      printMerchantCopy: store.printMerchantCopy,
      printBarcodeOnBottom: store.printBarcodeOnBottom,
      headerBusinessName: store.headerBusinessName || store.name,
      branchAddressLine: store.branchAddressLine || store.address || 'Karachi, Pakistan',
      phoneOnReceipt: store.phoneOnReceipt || store.phone || '0300-1234567',
      showCashierName: store.showCashierName,
      showCustomerLoyaltyPoints: store.showCustomerLoyaltyPoints,
      showKhataRemainingBalance: store.showKhataRemainingBalance,
      exchangePolicyFooter:
        store.exchangePolicyFooter ||
        'Exchange within 14 days with original receipt. Unwashed items only. No cash refunds.',
      instagramWebsiteHandle: store.instagramWebsiteHandle || '@retail.boutique.pk',
    };

    // 5. Sales, Stock & Credit Settings
    const salesStockCredit = {
      allowNegativeInventory: store.allowNegativeInventory,
      requireCustomerPhoneOnSale: store.requireCustomerPhoneOnSale,
      autoRoundToNearestRupee: store.autoRoundToNearestRupee,
      defaultPaymentMethod: store.defaultPaymentMethod || 'Cash',
      maxDiscountWithoutManagerPin: store.maxDiscountWithoutManagerPin,
      returnExchangeWindowDays: store.returnExchangeWindowDays,
      lowStockThresholdUnits: store.lowStockThresholdUnits,
      autoGenerateSkuPrefix: store.autoGenerateSkuPrefix || 'SKU-',
      enableVariantMatrix: store.enableVariantMatrix,
      warnDeadStockDays: store.warnDeadStockDays,
      enableKhataCreditAtPos: store.enableKhataCreditAtPos,
      defaultCreditLimit: paisaToRupees(store.defaultCreditLimit),
      defaultPaymentDueDays: store.defaultPaymentDueDays,
      blockNewCreditWhenOverdue: store.blockNewCreditWhenOverdue,
      autoSendWhatsAppReminder: store.autoSendWhatsAppReminder,
    };

    return {
      storeProfile,
      teamPermissions: {
        staffMembers,
        rolePermissions,
      },
      billingSubscription: {
        plan: billingPlan,
        usageMetrics,
        savedPaymentMethods,
        invoices: billingInvoices,
      },
      receiptPrinter,
      salesStockCredit,
    };
  }

  /**
   * 2. PATCH /api/v1/settings/store-profile
   * Update Store Metadata
   */
  async updateStoreProfile(storeId: string, dto: UpdateStoreProfileDto, userId?: string) {
    const updated = await this.prisma.store.update({
      where: { id: storeId },
      data: {
        ...(dto.storeName !== undefined ? { name: dto.storeName.trim() } : {}),
        ...(dto.tagline !== undefined ? { tagline: dto.tagline.trim() } : {}),
        ...(dto.storeCategory !== undefined ? { storeCategory: dto.storeCategory.trim() } : {}),
        ...(dto.primaryPhone !== undefined ? { phone: dto.primaryPhone.trim() } : {}),
        ...(dto.whatsappNumber !== undefined ? { whatsappNumber: dto.whatsappNumber.trim() } : {}),
        ...(dto.officialEmail !== undefined ? { officialEmail: dto.officialEmail.trim() } : {}),
        ...(dto.streetAddress !== undefined ? { address: dto.streetAddress.trim() } : {}),
        ...(dto.areaMarket !== undefined ? { areaMarket: dto.areaMarket.trim() } : {}),
        ...(dto.city !== undefined ? { city: dto.city.trim() } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency.trim() } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone.trim() } : {}),
        ...(dto.operatingHours !== undefined ? { operatingHours: dto.operatingHours.trim() } : {}),
        ...(dto.ntnNumber !== undefined ? { ntn: dto.ntnNumber.trim() } : {}),
        ...(dto.strnNumber !== undefined ? { strn: dto.strnNumber.trim() } : {}),
        ...(dto.fbrIntegrationEnabled !== undefined ? { fbrIntegrationEnabled: dto.fbrIntegrationEnabled } : {}),
        ...(dto.posRegistrationId !== undefined ? { posRegistrationId: dto.posRegistrationId.trim() } : {}),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        storeId,
        userId: userId || null,
        action: 'STORE_PROFILE_UPDATED',
        entity: 'Store',
        entityId: storeId,
        details: { storeName: updated.name, city: updated.city },
      },
    });

    return {
      storeName: updated.name,
      tagline: updated.tagline,
      city: updated.city,
      phone: updated.phone,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * 3. Staff & Cashier Management
   */
  async getStaff(storeId: string) {
    const users = await this.prisma.user.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
    });

    return users.map((u) => ({
      id: u.id,
      name: u.fullName,
      email: u.email,
      phone: u.phone || '0300-1234567',
      role: this.mapRoleToFrontend(u.role),
      assignedTerminal: u.assignedTerminal || 'All Counters',
      pinSet: !!(u.pinHash || u.otpCode),
      lastActive: formatDate(u.updatedAt),
      status: u.isActive ? ('active' as const) : ('suspended' as const),
      maxDiscountPercent: u.maxDiscountPercent || 10,
    }));
  }

  async createStaff(storeId: string, dto: CreateStaffMemberDto, creatorId?: string) {
    const cleanPhone = normalizePakistaniPhone(dto.phone);
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.email || `${cleanPhone}@retailpos.pk` },
          { phone: cleanPhone },
        ],
      },
    });

    if (existing) {
      throw new ConflictException('Staff member with this phone or email already exists');
    }

    const email = dto.email?.trim() || `${cleanPhone}@retailpos.pk`;
    const passwordHash = await bcrypt.hash(dto.pin || '1234', 10);
    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, 10) : null;
    const role = this.mapFrontendToRole(dto.role);

    const user = await this.prisma.user.create({
      data: {
        storeId,
        fullName: dto.name.trim(),
        email,
        phone: cleanPhone,
        role,
        passwordHash,
        pinHash,
        assignedTerminal: dto.assignedTerminal || 'All Counters',
        maxDiscountPercent: dto.maxDiscountPercent || 10,
        isEmailVerified: true,
        isActive: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        storeId,
        userId: creatorId || null,
        action: 'STAFF_MEMBER_CREATED',
        entity: 'User',
        entityId: user.id,
        details: { name: user.fullName, role: user.role },
      },
    });

    return {
      id: user.id,
      name: user.fullName,
      email: user.email,
      role: this.mapRoleToFrontend(user.role),
      assignedTerminal: user.assignedTerminal,
      status: 'active',
      createdAt: user.createdAt.toISOString(),
    };
  }

  async updateStaff(
    storeId: string,
    staffId: string,
    dto: UpdateStaffMemberDto,
    editorId?: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: staffId, storeId },
    });

    if (!user) {
      throw new NotFoundException(`Staff member ${staffId} not found`);
    }

    let pinHash = undefined;
    if (dto.pin && dto.pin.trim()) {
      pinHash = await bcrypt.hash(dto.pin.trim(), 10);
    }

    const role = dto.role ? this.mapFrontendToRole(dto.role) : undefined;
    const isActive =
      dto.status !== undefined ? dto.status.toLowerCase() === 'active' : undefined;

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(dto.name !== undefined ? { fullName: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() } : {}),
        ...(dto.email !== undefined ? { email: dto.email.trim() } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(pinHash !== undefined ? { pinHash } : {}),
        ...(dto.assignedTerminal !== undefined ? { assignedTerminal: dto.assignedTerminal } : {}),
        ...(dto.maxDiscountPercent !== undefined ? { maxDiscountPercent: dto.maxDiscountPercent } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        storeId,
        userId: editorId || null,
        action: 'STAFF_MEMBER_UPDATED',
        entity: 'User',
        entityId: updated.id,
        details: { name: updated.fullName, status: updated.isActive ? 'active' : 'suspended' },
      },
    });

    return {
      id: updated.id,
      name: updated.fullName,
      role: this.mapRoleToFrontend(updated.role),
      status: updated.isActive ? 'active' : 'suspended',
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async deleteStaff(storeId: string, staffId: string, editorId?: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: staffId, storeId },
    });

    if (!user) {
      throw new NotFoundException(`Staff member ${staffId} not found`);
    }

    if (user.role === Role.OWNER) {
      throw new BadRequestException('Cannot delete the primary Store Owner account');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    await this.prisma.auditLog.create({
      data: {
        storeId,
        userId: editorId || null,
        action: 'STAFF_MEMBER_DEACTIVATED',
        entity: 'User',
        entityId: user.id,
        details: { name: user.fullName },
      },
    });

    return { success: true, message: `Staff member ${user.fullName} suspended` };
  }

  /**
   * 4. PATCH /api/v1/settings/receipt-printer
   */
  async updateReceiptPrinter(
    storeId: string,
    dto: UpdateReceiptPrinterDto,
    userId?: string,
  ) {
    const updated = await this.prisma.store.update({
      where: { id: storeId },
      data: {
        ...(dto.paperSize !== undefined ? { paperSize: dto.paperSize } : {}),
        ...(dto.autoPrintReceipt !== undefined ? { autoPrintReceipt: dto.autoPrintReceipt } : {}),
        ...(dto.openDrawerOnCash !== undefined ? { openDrawerOnCash: dto.openDrawerOnCash } : {}),
        ...(dto.printMerchantCopy !== undefined ? { printMerchantCopy: dto.printMerchantCopy } : {}),
        ...(dto.printBarcodeOnBottom !== undefined ? { printBarcodeOnBottom: dto.printBarcodeOnBottom } : {}),
        ...(dto.headerBusinessName !== undefined ? { headerBusinessName: dto.headerBusinessName } : {}),
        ...(dto.branchAddressLine !== undefined ? { branchAddressLine: dto.branchAddressLine } : {}),
        ...(dto.phoneOnReceipt !== undefined ? { phoneOnReceipt: dto.phoneOnReceipt } : {}),
        ...(dto.showCashierName !== undefined ? { showCashierName: dto.showCashierName } : {}),
        ...(dto.showCustomerLoyaltyPoints !== undefined ? { showCustomerLoyaltyPoints: dto.showCustomerLoyaltyPoints } : {}),
        ...(dto.showKhataRemainingBalance !== undefined ? { showKhataRemainingBalance: dto.showKhataRemainingBalance } : {}),
        ...(dto.exchangePolicyFooter !== undefined ? { exchangePolicyFooter: dto.exchangePolicyFooter } : {}),
        ...(dto.instagramWebsiteHandle !== undefined ? { instagramWebsiteHandle: dto.instagramWebsiteHandle } : {}),
      },
    });

    return {
      paperSize: updated.paperSize,
      autoPrintReceipt: updated.autoPrintReceipt,
      headerBusinessName: updated.headerBusinessName,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * 5. PATCH /api/v1/settings/sales-stock-credit
   */
  async updateSalesStockCredit(
    storeId: string,
    dto: UpdateSalesStockCreditDto,
    userId?: string,
  ) {
    const updated = await this.prisma.store.update({
      where: { id: storeId },
      data: {
        ...(dto.allowNegativeInventory !== undefined ? { allowNegativeInventory: dto.allowNegativeInventory } : {}),
        ...(dto.requireCustomerPhoneOnSale !== undefined ? { requireCustomerPhoneOnSale: dto.requireCustomerPhoneOnSale } : {}),
        ...(dto.autoRoundToNearestRupee !== undefined ? { autoRoundToNearestRupee: dto.autoRoundToNearestRupee } : {}),
        ...(dto.defaultPaymentMethod !== undefined ? { defaultPaymentMethod: dto.defaultPaymentMethod } : {}),
        ...(dto.maxDiscountWithoutManagerPin !== undefined ? { maxDiscountWithoutManagerPin: dto.maxDiscountWithoutManagerPin } : {}),
        ...(dto.returnExchangeWindowDays !== undefined ? { returnExchangeWindowDays: dto.returnExchangeWindowDays } : {}),
        ...(dto.lowStockThresholdUnits !== undefined ? { lowStockThresholdUnits: dto.lowStockThresholdUnits } : {}),
        ...(dto.autoGenerateSkuPrefix !== undefined ? { autoGenerateSkuPrefix: dto.autoGenerateSkuPrefix } : {}),
        ...(dto.enableVariantMatrix !== undefined ? { enableVariantMatrix: dto.enableVariantMatrix } : {}),
        ...(dto.warnDeadStockDays !== undefined ? { warnDeadStockDays: dto.warnDeadStockDays } : {}),
        ...(dto.enableKhataCreditAtPos !== undefined ? { enableKhataCreditAtPos: dto.enableKhataCreditAtPos } : {}),
        ...(dto.defaultCreditLimit !== undefined ? { defaultCreditLimit: rupeesToPaisa(dto.defaultCreditLimit) } : {}),
        ...(dto.defaultPaymentDueDays !== undefined ? { defaultPaymentDueDays: dto.defaultPaymentDueDays } : {}),
        ...(dto.blockNewCreditWhenOverdue !== undefined ? { blockNewCreditWhenOverdue: dto.blockNewCreditWhenOverdue } : {}),
        ...(dto.autoSendWhatsAppReminder !== undefined ? { autoSendWhatsAppReminder: dto.autoSendWhatsAppReminder } : {}),
      },
    });

    return {
      defaultCreditLimit: paisaToRupees(updated.defaultCreditLimit),
      maxDiscountWithoutManagerPin: updated.maxDiscountWithoutManagerPin,
      returnExchangeWindowDays: updated.returnExchangeWindowDays,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}
