import { IsEnum, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum PointsAdjustmentMode {
  ADD = 'ADD',
  DEDUCT = 'DEDUCT',
}

export class AdjustCustomerPointsDto {
  @IsNotEmpty()
  @IsEnum(PointsAdjustmentMode)
  mode: PointsAdjustmentMode;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  points: number;

  @IsNotEmpty()
  @IsString()
  reason: string;
}
