import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { rupeesToPaisa } from '@core/utils/currency-paisa.util';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(storeId: string) {
    return this.prisma.category.findMany({
      where: { storeId, isActive: true },
      include: { subCategories: true },
    });
  }

  async createCategory(storeId: string, dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: {
        storeId,
        name: dto.name,
        description: dto.description,
        parentId: dto.parentId,
      },
    });
  }

  async listProducts(storeId: string, query: PaginationQueryDto) {
    const where = {
      storeId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { barcode: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: {
          category: true,
          variants: true,
        },
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

  async getProductById(storeId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, storeId },
      include: {
        category: true,
        variants: true,
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return product;
  }

  async createProduct(storeId: string, dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        storeId,
        name: dto.name,
        categoryId: dto.categoryId,
        description: dto.description,
        barcode: dto.barcode,
        variants: dto.variants?.length
          ? {
              create: dto.variants.map((v) => ({
                storeId,
                name: v.name,
                sku: v.sku,
                barcode: v.barcode,
                costPrice: rupeesToPaisa(v.costPrice),
                retailPrice: rupeesToPaisa(v.retailPrice),
              })),
            }
          : undefined,
      },
      include: {
        variants: true,
      },
    });
  }

  async updateProduct(storeId: string, id: string, dto: UpdateProductDto) {
    await this.getProductById(storeId, id);

    return this.prisma.product.update({
      where: { id },
      data: dto,
      include: {
        variants: true,
      },
    });
  }
}
