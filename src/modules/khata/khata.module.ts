import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { KhataController } from './khata.controller';
import { KhataService } from './khata.service';

@Module({
  imports: [AuthModule],
  controllers: [KhataController],
  providers: [KhataService],
  exports: [KhataService],
})
export class KhataModule {}
