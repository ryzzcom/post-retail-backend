import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import { CsvImportDto } from './dto/csv-import.dto';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Role } from '@prisma/client';

@Controller('api/v1/catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // ---------------------------------------------------------
  // Categories
  // ---------------------------------------------------------
  @Get('categories')
  @Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
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

  // ---------------------------------------------------------
  // Barcode Utilities & Scanner Lookup
  // ---------------------------------------------------------
  @Get('barcode/generate')
  @Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
  async generateBarcode(@CurrentTenant('storeId') storeId: string) {
    return this.catalogService.generateBarcode(storeId);
  }

  @Get('barcode/:barcode')
  @Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
  async lookupBarcode(
    @CurrentTenant('storeId') storeId: string,
    @Param('barcode') barcode: string,
  ) {
    return this.catalogService.lookupBarcode(storeId, barcode);
  }

  // ---------------------------------------------------------
  // CSV Import & Export (Shopify + POS Dual Format)
  // ---------------------------------------------------------
  @Get('export')
  @Roles(Role.OWNER, Role.MANAGER)
  async exportCsv(
    @CurrentTenant('storeId') storeId: string,
    @Query('format') format?: string,
  ) {
    return this.catalogService.exportCsv(storeId, format || 'shopify');
  }

  @Post('import')
  @Roles(Role.OWNER, Role.MANAGER)
  async importCsv(
    @CurrentTenant('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CsvImportDto,
  ) {
    return this.catalogService.importCsv(storeId, userId, dto);
  }

  // ---------------------------------------------------------
  // Products Catalog Endpoints
  // ---------------------------------------------------------
  @Get('products')
  @Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
  async listProducts(
    @CurrentTenant('storeId') storeId: string,
    @Query() query: CatalogQueryDto,
  ) {
    return this.catalogService.getProducts(storeId, query);
  }

  @Get('products/:id')
  @Roles(Role.OWNER, Role.MANAGER, Role.CASHIER)
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
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.catalogService.createProduct(storeId, userId, dto);
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

  @Patch('products/:id/archive')
  @Roles(Role.OWNER, Role.MANAGER)
  async archiveProduct(
    @CurrentTenant('storeId') storeId: string,
    @Param('id') id: string,
    @Body('archive') archive?: boolean,
  ) {
    return this.catalogService.archiveProduct(
      storeId,
      id,
      archive !== undefined ? archive : true,
    );
  }
}
