import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateReceiptPrinterDto {
  @IsOptional()
  @IsIn(['80mm', '58mm', 'a4', '80MM', '58MM', 'A4'])
  paperSize?: string;

  @IsOptional()
  @IsBoolean()
  autoPrintReceipt?: boolean;

  @IsOptional()
  @IsBoolean()
  openDrawerOnCash?: boolean;

  @IsOptional()
  @IsBoolean()
  printMerchantCopy?: boolean;

  @IsOptional()
  @IsBoolean()
  printBarcodeOnBottom?: boolean;

  @IsOptional()
  @IsString()
  headerBusinessName?: string;

  @IsOptional()
  @IsString()
  branchAddressLine?: string;

  @IsOptional()
  @IsString()
  phoneOnReceipt?: string;

  @IsOptional()
  @IsBoolean()
  showCashierName?: boolean;

  @IsOptional()
  @IsBoolean()
  showCustomerLoyaltyPoints?: boolean;

  @IsOptional()
  @IsBoolean()
  showKhataRemainingBalance?: boolean;

  @IsOptional()
  @IsString()
  exchangePolicyFooter?: string;

  @IsOptional()
  @IsString()
  instagramWebsiteHandle?: string;
}

export class UpdateSalesStockCreditDto {
  @IsOptional()
  @IsBoolean()
  allowNegativeInventory?: boolean;

  @IsOptional()
  @IsBoolean()
  requireCustomerPhoneOnSale?: boolean;

  @IsOptional()
  @IsBoolean()
  autoRoundToNearestRupee?: boolean;

  @IsOptional()
  @IsString()
  defaultPaymentMethod?: string;

  @IsOptional()
  maxDiscountWithoutManagerPin?: number;

  @IsOptional()
  returnExchangeWindowDays?: number;

  @IsOptional()
  lowStockThresholdUnits?: number;

  @IsOptional()
  @IsString()
  autoGenerateSkuPrefix?: string;

  @IsOptional()
  @IsBoolean()
  enableVariantMatrix?: boolean;

  @IsOptional()
  warnDeadStockDays?: number;

  @IsOptional()
  @IsBoolean()
  enableKhataCreditAtPos?: boolean;

  @IsOptional()
  defaultCreditLimit?: number; // PKR Rupees

  @IsOptional()
  defaultPaymentDueDays?: number;

  @IsOptional()
  @IsBoolean()
  blockNewCreditWhenOverdue?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSendWhatsAppReminder?: boolean;
}
