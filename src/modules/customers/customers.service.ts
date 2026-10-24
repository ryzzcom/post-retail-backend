import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { rupeesToPaisa } from '@core/utils/currency-paisa.util';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async createCustomer(storeId: string, dto: CreateCustomerDto) {
    const creditLimitPaisa = dto.creditLimit
      ? rupeesToPaisa(dto.creditLimit)
      : 0n;

    return this.prisma.customer.create({
      data: {
        storeId,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        creditLimit: creditLimitPaisa,
      },
    });
  }

  async listCustomers(storeId: string, query: PaginationQueryDto) {
    const where = {
      storeId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { phone: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: query.sortBy ? { [query.sortBy]: query.sortOrder } : { createdAt: 'desc' },
      }),
    ]);

    return {
      data: items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getCustomerById(storeId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, storeId },
      include: {
        khataLedgers: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    return customer;
  }

  async searchByPhone(storeId: string, phone: string) {
    return this.prisma.customer.findFirst({
      where: { storeId, phone },
    });
  }

  async updateCustomer(storeId: string, id: string, dto: UpdateCustomerDto) {
    await this.getCustomerById(storeId, id);

    return this.prisma.customer.update({
      where: { id },
      data: {
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        isActive: dto.isActive,
        creditLimit: dto.creditLimit !== undefined ? rupeesToPaisa(dto.creditLimit) : undefined,
      },
    });
  }
}
