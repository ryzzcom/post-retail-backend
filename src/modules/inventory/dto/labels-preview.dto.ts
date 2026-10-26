import { IsArray, IsInt, IsNotEmpty, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class LabelItemDto {
  @IsNotEmpty()
  @IsString()
  variantId: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  copies: number = 1;
}

export class LabelsPreviewDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LabelItemDto)
  items: LabelItemDto[];
}
