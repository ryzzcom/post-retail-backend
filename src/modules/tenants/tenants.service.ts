import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { UpdateStoreDto } from './dto/update-store.dto';
import { CreateCounterDto } from './dto/create-counter.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStore(storeId: string) {
    return this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        counters: true,
      },
    });
  }

  async updateStore(storeId: string, dto: UpdateStoreDto) {
    return this.prisma.store.update({
      where: { id: storeId },
      data: dto,
    });
  }

  async listCounters(storeId: string) {
    return this.prisma.counter.findMany({
      where: { storeId },
    });
  }

  async createCounter(storeId: string, dto: CreateCounterDto) {
    return this.prisma.counter.create({
      data: {
        storeId,
        name: dto.name,
        code: dto.code,
      },
    });
  }
}
