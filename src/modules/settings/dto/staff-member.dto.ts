import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateStaffMemberDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsNotEmpty()
  @IsIn(['owner', 'manager', 'cashier', 'inventory_clerk', 'OWNER', 'MANAGER', 'CASHIER'])
  role: string;

  @IsOptional()
  @IsString()
  pin?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxDiscountPercent?: number = 10;

  @IsOptional()
  @IsString()
  assignedTerminal?: string = 'All Counters';
}

export class UpdateStaffMemberDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsIn(['owner', 'manager', 'cashier', 'inventory_clerk', 'OWNER', 'MANAGER', 'CASHIER'])
  role?: string;

  @IsOptional()
  @IsString()
  pin?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxDiscountPercent?: number;

  @IsOptional()
  @IsString()
  assignedTerminal?: string;

  @IsOptional()
  @IsIn(['active', 'suspended', 'ACTIVE', 'SUSPENDED'])
  status?: string;
}
