import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCounterDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  code: string;
}
