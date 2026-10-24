import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = Number(this.configService.get<number>('REDIS_PORT', 6379));

    try {
      this.client = new Redis({
        host,
        port,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        retryStrategy: (times) => {
          if (times > 3) {
            this.logger.warn(`Redis retry limit reached (${times}). Operating in degraded mode.`);
            return null; // Stop retrying automatically to avoid noisy logs
          }
          return Math.min(times * 200, 2000);
        },
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log(`Connected to Redis instance at ${host}:${port}`);
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        this.logger.warn(`Redis connection error: ${err.message}`);
      });

      // Attempt async connection without blocking Nest bootstrap if Redis is temporarily offline
      this.client.connect().catch((err) => {
        this.logger.warn(`Initial Redis connection could not be established: ${err.message}`);
      });
    } catch (err: any) {
      this.logger.warn(`Redis client initialization error: ${err.message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        this.logger.log('Disconnected from Redis instance');
      } catch {
        this.client.disconnect();
      }
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    if (!this.client || !this.isConnected) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client || !this.isConnected) return;
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to set Redis key ${key}: ${err.message}`);
    }
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client || !this.isConnected) return true; // Fail open if Redis unavailable
    try {
      const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch {
      return true;
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client || !this.isConnected) return;
    try {
      await this.client.del(key);
    } catch (err: any) {
      this.logger.warn(`Failed to del Redis key ${key}: ${err.message}`);
    }
  }
}
