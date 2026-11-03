import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { SalesModule } from '@modules/sales/sales.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  imports: [AuthModule, SalesModule],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
