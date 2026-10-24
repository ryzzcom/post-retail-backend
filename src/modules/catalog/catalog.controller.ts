import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('api/v1/catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('categories')
  async listCategories(@CurrentTenant('storeId') storeId: string) {
    return this.catalogService.listCategories(storeId);
  }

  @Post('categories')
  @Roles(Role.OWNER, Role.MANAGER)
  async createCategory(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.catalogService.createCategory(storeId, dto);
  }

  @Get('products')
  async listProducts(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.catalogService.listProducts(storeId, query);
  }

  @Get('products/:id')
  async getProduct(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.catalogService.getProductById(storeId, id);
  }

  @Post('products')
  @Roles(Role.OWNER, Role.MANAGER)
  async createProduct(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.catalogService.createProduct(storeId, dto);
  }

  @Patch('products/:id')
  @Roles(Role.OWNER, Role.MANAGER)
  async updateProduct(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalogService.updateProduct(storeId, id, dto);
  }
}
