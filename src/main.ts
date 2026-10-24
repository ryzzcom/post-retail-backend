import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from '@core/filters/global-exception.filter';
import { TransformInterceptor } from '@core/interceptors/transform.interceptor';

// Ensure BigInt serialization works natively across all JSON.stringify occurrences
(BigInt.prototype as any).toJSON = function (): string {
  return this.toString();
};

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 4000);
  const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';

  // CORS configuration
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-idempotency-key'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global filters and interceptors
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  // Graceful shutdown hooks
  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(`POS Retail Backend is running on: http://localhost:${port}`);
  logger.log(`CORS allowed origin: ${corsOrigin}`);
}

bootstrap();
