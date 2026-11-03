import { IsIn, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateTemplateDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  name: string;

  @IsNotEmpty()
  @IsIn([
    'Digital receipt',
    'Loyalty update',
    'New arrivals',
    'Khata reminder',
    'Review request',
    'Marketing',
  ])
  category: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(10)
  body: string;
}

export class SendWhatsAppReceiptDto {
  @IsNotEmpty()
  @IsString()
  receiptNo: string;

  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsNotEmpty()
  @IsString()
  customerName: string;
}
