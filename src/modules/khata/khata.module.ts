import { Module } from '@nestjs/common';
import { KhataController } from './khata.controller';
import { KhataService } from './khata.service';

@Module({
  controllers: [KhataController],
  providers: [KhataService],
  exports: [KhataService],
})
export class KhataModule {}
