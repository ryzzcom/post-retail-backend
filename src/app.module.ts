import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@database/prisma.module';
import { RedisModule } from '@core/redis/redis.module';
import { MailModule } from '@core/mail/mail.module';
import { AppController } from './app.controller';

// 9 Domain Modules
import { AuthModule } from '@modules/auth/auth.module';
import { TenantsModule } from '@modules/tenants/tenants.module';
import { CatalogModule } from '@modules/catalog/catalog.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { PosModule } from '@modules/pos/pos.module';
import { ShiftsModule } from '@modules/shifts/shifts.module';
import { CustomersModule } from '@modules/customers/customers.module';
import { KhataModule } from '@modules/khata/khata.module';
import { FinanceModule } from '@modules/finance/finance.module';
import { DashboardModule } from '@modules/dashboard/dashboard.module';
import { SalesModule } from '@modules/sales/sales.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    RedisModule,
    MailModule,

    // Domain feature modules
    AuthModule,
    TenantsModule,
    CatalogModule,
    InventoryModule,
    PosModule,
    ShiftsModule,
    CustomersModule,
    KhataModule,
    FinanceModule,
    DashboardModule,
    SalesModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
