import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  CatalogProductStatus,
  CatalogQueryDto,
  CatalogSortBy,
} from './dto/catalog-query.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CsvImportDto } from './dto/csv-import.dto';
import { paisaToRupees, rupeesToPaisa } from '@core/utils/currency-paisa.util';
import { generateEan13Barcode } from '@core/utils/barcode.util';
import { objectsToCsv, parseCsvToObjects } from '@core/utils/csv-parser.util';
import { StockMovementType } from '@prisma/client';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all categories for store
   */
  async listCategories(storeId: string) {
    return this.prisma.category.findMany({
      where: { storeId, isActive: true },
      include: { subCategories: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Create category
   */
  async createCategory(storeId: string, dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: {
        storeId,
        name: dto.name.trim(),
        description: dto.description,
        parentId: dto.parentId,
      },
    });
  }

  /**
   * Main Catalog List with Expandable Parent-Child Rows and Top Summary KPI Strip
   */
  async getProducts(storeId: string, query: CatalogQueryDto) {
    const isArchivedFilter =
      query.status === CatalogProductStatus.ALL
        ? undefined
        : query.status === CatalogProductStatus.ARCHIVED
          ? true
          : false;

    // Build Where Clause
    const where: any = {
      storeId,
      ...(isArchivedFilter !== undefined ? { isArchived: isArchivedFilter } : {}),
    };

    // Category Filter
    if (query.categoryId) {
      where.categoryId = query.categoryId;
    } else if (query.category && query.category.toUpperCase() !== 'ALL') {
      where.category = {
        name: { equals: query.category.trim(), mode: 'insensitive' as const },
      };
    }

    // Search Filter (Product name, styleCode, variant sku, barcode)
    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' as const } },
        { styleCode: { contains: term, mode: 'insensitive' as const } },
        { brand: { contains: term, mode: 'insensitive' as const } },
        {
          variants: {
            some: {
              OR: [
                { sku: { contains: term, mode: 'insensitive' as const } },
                { barcode: { contains: term, mode: 'insensitive' as const } },
              ],
            },
          },
        },
      ];
    }

    // Run parallel queries: Summary Strip KPIs + Paginated Products List
    const [activeProductsCount, allActiveVariants, totalMatching, rawProducts] =
      await Promise.all([
        // 1. Total Active Products Count
        this.prisma.product.count({
          where: { storeId, isArchived: false, isActive: true },
        }),

        // 2. All active variants in store to compute summary inventory KPIs
        this.prisma.productVariant.findMany({
          where: {
            storeId,
            isActive: true,
            product: { isArchived: false },
          },
          select: {
            costPrice: true,
            reorderLevel: true,
            inventory: {
              where: { storeId },
              select: { quantityOnHand: true },
            },
          },
        }),

        // 3. Count total matching products for pagination
        this.prisma.product.count({ where }),

        // 4. Fetch products with relations
        this.prisma.product.findMany({
          where,
          include: {
            category: { select: { id: true, name: true } },
            variants: {
              include: {
                inventory: {
                  where: { storeId },
                  select: { quantityOnHand: true },
                },
              },
              orderBy: [{ size: 'asc' }, { color: 'asc' }, { sku: 'asc' }],
            },
          },
          orderBy:
            query.sortBy === CatalogSortBy.NAME_ASC
              ? { name: 'asc' }
              : query.sortBy === CatalogSortBy.NAME_DESC
                ? { name: 'desc' }
                : query.sortBy === CatalogSortBy.PRICE_ASC
                  ? { minSellingPrice: 'asc' }
                  : query.sortBy === CatalogSortBy.PRICE_DESC
                    ? { minSellingPrice: 'desc' }
                    : { createdAt: 'desc' },
        }),
      ]);

    // Compute Summary Strip Metrics
    let totalUnitsOnHand = 0;
    let totalValuationCost = 0;
    let lowStockVariantsCount = 0;

    for (const v of allActiveVariants) {
      const stock = v.inventory[0]?.quantityOnHand ?? 0;
      totalUnitsOnHand += stock;
      totalValuationCost += stock * paisaToRupees(v.costPrice);
      if (stock <= v.reorderLevel) {
        lowStockVariantsCount++;
      }
    }

    // Transform products into parent-child rows
    let items = rawProducts.map((p) => {
      const variants = p.variants.map((v) => {
        const stockOnHand = v.inventory[0]?.quantityOnHand ?? 0;
        const isLowStock = stockOnHand <= v.reorderLevel;
        const costPrice = paisaToRupees(v.costPrice);
        const retailPrice = paisaToRupees(v.retailPrice);
        const colorSizeParts = [v.color, v.size].filter(Boolean);
        const colorSizeLabel =
          colorSizeParts.length > 0 ? colorSizeParts.join(' · ') : 'Standard';

        return {
          id: v.id,
          colorSizeLabel,
          color: v.color,
          size: v.size,
          sku: v.sku,
          barcode: v.barcode,
          costPrice,
          retailPrice,
          reorderLevel: v.reorderLevel,
          stockOnHand,
          isLowStock,
        };
      });

      const totalOnHand = variants.reduce((sum, v) => sum + v.stockOnHand, 0);
      const lowStockCount = variants.filter((v) => v.isLowStock).length;

      // Calculate representative retail price & average cost for margin
      const retailPrices = variants.map((v) => v.retailPrice).filter((p) => p > 0);
      const representativeRetail =
        retailPrices.length > 0
          ? Math.min(...retailPrices)
          : paisaToRupees(p.minSellingPrice);

      const costPrices = variants.map((v) => v.costPrice).filter((c) => c > 0);
      const avgCost =
        costPrices.length > 0
          ? costPrices.reduce((a, b) => a + b, 0) / costPrices.length
          : 0;

      const marginPct =
        representativeRetail > 0
          ? Math.round(((representativeRetail - avgCost) / representativeRetail) * 100)
          : 0;

      const subtitleParts = [p.styleCode, p.subCategory, p.brand].filter(Boolean);
      const subtitle = subtitleParts.join(' · ');

      return {
        id: p.id,
        name: p.name,
        styleCode: p.styleCode,
        subCategory: p.subCategory,
        brand: p.brand,
        season: p.season,
        subtitle,
        category: p.category ? { id: p.category.id, name: p.category.name } : null,
        variantsCount: variants.length,
        lowStockCount,
        totalOnHand,
        retailPrice: representativeRetail,
        minSellingPrice: paisaToRupees(p.minSellingPrice),
        marginPct,
        isArchived: p.isArchived,
        imageUrl: p.imageUrl,
        variants,
      };
    });

    // Handle lowStockOnly filter if requested
    if (query.lowStockOnly) {
      items = items.filter((item) => item.lowStockCount > 0);
    }

    // Handle in-memory stock sorting if requested
    if (query.sortBy === CatalogSortBy.STOCK_ASC) {
      items.sort((a, b) => a.totalOnHand - b.totalOnHand);
    } else if (query.sortBy === CatalogSortBy.STOCK_DESC) {
      items.sort((a, b) => b.totalOnHand - a.totalOnHand);
    }

    // Apply pagination
    const total = items.length;
    const paginatedItems = items.slice(query.skip, query.skip + query.limit);

    return {
      summary: {
        activeProductsCount,
        totalUnitsOnHand,
        totalValuationCost: Math.round(totalValuationCost),
        lowStockVariantsCount,
      },
      items: paginatedItems,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  /**
   * Fetch single product with full variants and inventory
   */
  async getProductById(storeId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, storeId },
      include: {
        category: true,
        variants: {
          include: {
            inventory: {
              where: { storeId },
            },
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return {
      ...product,
      minSellingPrice: paisaToRupees(product.minSellingPrice),
      variants: product.variants.map((v) => ({
        ...v,
        costPrice: paisaToRupees(v.costPrice),
        retailPrice: paisaToRupees(v.retailPrice),
        stockOnHand: v.inventory[0]?.quantityOnHand ?? 0,
      })),
    };
  }

  /**
   * Create Product with atomic variant matrix, inventory initialization, and opening stock ledger
   */
  async createProduct(storeId: string, userId: string, dto: CreateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Resolve or auto-create Category
      let categoryId = dto.categoryId;
      if (!categoryId && dto.categoryName && dto.categoryName.trim()) {
        const catName = dto.categoryName.trim();
        let existingCategory = await tx.category.findFirst({
          where: {
            storeId,
            name: { equals: catName, mode: 'insensitive' },
          },
        });
        if (!existingCategory) {
          existingCategory = await tx.category.create({
            data: {
              storeId,
              name: catName,
            },
          });
        }
        categoryId = existingCategory.id;
      }

      // Generate handle slug if omitted
      const handle =
        dto.handle ||
        dto.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)+/g, '');

      // 2. Create Parent Product
      const product = await tx.product.create({
        data: {
          storeId,
          categoryId,
          name: dto.name.trim(),
          styleCode: dto.styleCode?.trim(),
          subCategory: dto.subCategory?.trim(),
          brand: dto.brand?.trim(),
          season: dto.season?.trim(),
          minSellingPrice: rupeesToPaisa(dto.minSellingPrice || 0),
          imageUrl: dto.imageUrl,
          handle,
        },
      });

      // 3. Process Variants
      const createdVariants = [];

      for (const vDto of dto.variants) {
        // Validate SKU uniqueness within store
        const existingSku = await tx.productVariant.findUnique({
          where: {
            storeId_sku: { storeId, sku: vDto.sku.trim() },
          },
        });
        if (existingSku) {
          throw new ConflictException(
            `Variant with SKU "${vDto.sku}" already exists in your store`,
          );
        }

        // Determine or auto-generate EAN-13 barcode
        let barcode = vDto.barcode?.trim();
        if (!barcode) {
          let attempts = 0;
          let candidate = generateEan13Barcode('8964');
          while (attempts < 10) {
            const collision = await tx.productVariant.findFirst({
              where: { storeId, barcode: candidate },
            });
            if (!collision) break;
            candidate = generateEan13Barcode('8964');
            attempts++;
          }
          barcode = candidate;
        }

        const openingStock = Math.max(0, vDto.openingStock || 0);

        // Create Variant
        const variant = await tx.productVariant.create({
          data: {
            storeId,
            productId: product.id,
            sku: vDto.sku.trim(),
            barcode,
            color: vDto.color?.trim() || null,
            size: vDto.size?.trim() || null,
            costPrice: rupeesToPaisa(vDto.costPrice),
            retailPrice: rupeesToPaisa(vDto.retailPrice),
            reorderLevel: vDto.reorderLevel ?? 3,
          },
        });

        // Initialize StoreInventory
        const inventory = await tx.storeInventory.create({
          data: {
            storeId,
            variantId: variant.id,
            quantityOnHand: openingStock,
            lowStockThreshold: variant.reorderLevel,
          },
        });

        // If openingStock > 0, log OPENING_STOCK movement in ledger
        if (openingStock > 0) {
          await tx.stockMovement.create({
            data: {
              storeId,
              variantId: variant.id,
              type: StockMovementType.OPENING_STOCK,
              quantity: openingStock,
              previousQty: 0,
              newQty: openingStock,
              note: 'Opening stock on product creation',
              performedByUserId: userId,
            },
          });
        }

        createdVariants.push({
          ...variant,
          costPrice: vDto.costPrice,
          retailPrice: vDto.retailPrice,
          stockOnHand: openingStock,
        });
      }

      return {
        ...product,
        minSellingPrice: dto.minSellingPrice,
        variants: createdVariants,
      };
    });
  }

  /**
   * Update Product metadata, minSellingPrice, and variant pricing/reorder levels
   */
  async updateProduct(storeId: string, id: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findFirst({
      where: { id, storeId },
    });
    if (!existing) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      let categoryId = dto.categoryId;
      if (!categoryId && dto.categoryName && dto.categoryName.trim()) {
        const catName = dto.categoryName.trim();
        let cat = await tx.category.findFirst({
          where: { storeId, name: { equals: catName, mode: 'insensitive' } },
        });
        if (!cat) {
          cat = await tx.category.create({
            data: { storeId, name: catName },
          });
        }
        categoryId = cat.id;
      }

      // Update parent product
      await tx.product.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(dto.styleCode !== undefined ? { styleCode: dto.styleCode?.trim() || null } : {}),
          ...(dto.subCategory !== undefined ? { subCategory: dto.subCategory?.trim() || null } : {}),
          ...(dto.brand !== undefined ? { brand: dto.brand?.trim() || null } : {}),
          ...(dto.season !== undefined ? { season: dto.season?.trim() || null } : {}),
          ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
          ...(dto.handle !== undefined ? { handle: dto.handle } : {}),
          ...(dto.isArchived !== undefined ? { isArchived: dto.isArchived } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
          ...(dto.minSellingPrice !== undefined
            ? { minSellingPrice: rupeesToPaisa(dto.minSellingPrice) }
            : {}),
        },
      });

      // Update variants if provided
      if (dto.variants && dto.variants.length > 0) {
        for (const vDto of dto.variants) {
          if (vDto.id) {
            await tx.productVariant.update({
              where: { id: vDto.id },
              data: {
                ...(vDto.color !== undefined ? { color: vDto.color?.trim() || null } : {}),
                ...(vDto.size !== undefined ? { size: vDto.size?.trim() || null } : {}),
                ...(vDto.sku !== undefined ? { sku: vDto.sku.trim() } : {}),
                ...(vDto.barcode !== undefined ? { barcode: vDto.barcode?.trim() || null } : {}),
                ...(vDto.costPrice !== undefined
                  ? { costPrice: rupeesToPaisa(vDto.costPrice) }
                  : {}),
                ...(vDto.retailPrice !== undefined
                  ? { retailPrice: rupeesToPaisa(vDto.retailPrice) }
                  : {}),
                ...(vDto.reorderLevel !== undefined
                  ? { reorderLevel: vDto.reorderLevel }
                  : {}),
                ...(vDto.isActive !== undefined ? { isActive: vDto.isActive } : {}),
              },
            });
          }
        }
      }

      return this.getProductById(storeId, id);
    });
  }

  /**
   * Archive / Unarchive Product
   */
  async archiveProduct(storeId: string, id: string, archive = true) {
    const existing = await this.prisma.product.findFirst({
      where: { id, storeId },
    });
    if (!existing) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: { isArchived: archive },
    });

    return {
      id: updated.id,
      isArchived: updated.isArchived,
      message: archive ? 'Product archived successfully' : 'Product restored successfully',
    };
  }

  /**
   * Generate fresh collision-free 13-digit EAN-13 barcode starting with 8964
   */
  async generateBarcode(storeId: string): Promise<{ barcode: string }> {
    let attempts = 0;
    while (attempts < 20) {
      const barcode = generateEan13Barcode('8964');
      const collision = await this.prisma.productVariant.findFirst({
        where: { storeId, barcode },
      });
      if (!collision) {
        return { barcode };
      }
      attempts++;
    }
    throw new BadRequestException('Could not generate unique barcode. Please retry.');
  }

  /**
   * Fast POS Barcode Scanner Lookup (<10ms)
   */
  async lookupBarcode(storeId: string, barcode: string) {
    const cleanBarcode = barcode.trim();

    // 1. Check ProductVariant by barcode
    const variant = await this.prisma.productVariant.findFirst({
      where: { storeId, barcode: cleanBarcode, isActive: true },
      include: {
        product: {
          include: { category: true },
        },
        inventory: {
          where: { storeId },
        },
      },
    });

    if (variant) {
      const stockOnHand = variant.inventory[0]?.quantityOnHand ?? 0;
      const colorSizeParts = [variant.color, variant.size].filter(Boolean);
      const colorSizeLabel =
        colorSizeParts.length > 0 ? colorSizeParts.join(' · ') : 'Standard';

      return {
        variantId: variant.id,
        productId: variant.product.id,
        productName: variant.product.name,
        styleCode: variant.product.styleCode,
        subCategory: variant.product.subCategory,
        brand: variant.product.brand,
        color: variant.color,
        size: variant.size,
        colorSizeLabel,
        sku: variant.sku,
        barcode: variant.barcode,
        costPrice: paisaToRupees(variant.costPrice),
        retailPrice: paisaToRupees(variant.retailPrice),
        minSellingPrice: paisaToRupees(variant.product.minSellingPrice),
        stockOnHand,
        category: variant.product.category?.name || 'General',
        imageUrl: variant.product.imageUrl,
      };
    }

    // 2. Check if barcode was assigned to a parent Product
    const product = await this.prisma.product.findFirst({
      where: { storeId, barcode: cleanBarcode, isActive: true, isArchived: false },
      include: {
        category: true,
        variants: {
          where: { isActive: true },
          include: {
            inventory: { where: { storeId } },
          },
        },
      },
    });

    if (product && product.variants.length > 0) {
      const firstVariant = product.variants[0];
      const stockOnHand = firstVariant.inventory[0]?.quantityOnHand ?? 0;
      const colorSizeParts = [firstVariant.color, firstVariant.size].filter(Boolean);
      const colorSizeLabel =
        colorSizeParts.length > 0 ? colorSizeParts.join(' · ') : 'Standard';

      return {
        variantId: firstVariant.id,
        productId: product.id,
        productName: product.name,
        styleCode: product.styleCode,
        subCategory: product.subCategory,
        brand: product.brand,
        color: firstVariant.color,
        size: firstVariant.size,
        colorSizeLabel,
        sku: firstVariant.sku,
        barcode: firstVariant.barcode || product.barcode,
        costPrice: paisaToRupees(firstVariant.costPrice),
        retailPrice: paisaToRupees(firstVariant.retailPrice),
        minSellingPrice: paisaToRupees(product.minSellingPrice),
        stockOnHand,
        category: product.category?.name || 'General',
        imageUrl: product.imageUrl,
      };
    }

    throw new NotFoundException(`No product or variant found for barcode "${cleanBarcode}"`);
  }

  /**
   * Export Products & Variants in universal Shopify + POS compatible CSV format
   */
  async exportCsv(storeId: string, format = 'shopify') {
    const products = await this.prisma.product.findMany({
      where: { storeId, isArchived: false },
      include: {
        category: true,
        variants: {
          include: {
            inventory: { where: { storeId } },
          },
          orderBy: { sku: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const headers = [
      'Handle',
      'Title',
      'Design Code',
      'Product Category',
      'Sub-Category',
      'Vendor',
      'Season',
      'Option1 Name',
      'Option1 Value',
      'Option2 Name',
      'Option2 Value',
      'Variant SKU',
      'Variant Barcode',
      'Variant Inventory Qty',
      'Variant Price',
      'Cost per item',
      'Min Selling Price',
      'Reorder Level',
      'Image Src',
      'Status',
    ];

    const rows: Record<string, any>[] = [];

    for (const p of products) {
      const handle =
        p.handle ||
        p.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)+/g, '');

      for (const v of p.variants) {
        const stockOnHand = v.inventory[0]?.quantityOnHand ?? 0;
        rows.push({
          Handle: handle,
          Title: p.name,
          'Design Code': p.styleCode || '',
          'Product Category': p.category?.name || 'General',
          'Sub-Category': p.subCategory || '',
          Vendor: p.brand || '',
          Season: p.season || '',
          'Option1 Name': 'Color',
          'Option1 Value': v.color || 'Standard',
          'Option2 Name': 'Size',
          'Option2 Value': v.size || 'Standard',
          'Variant SKU': v.sku,
          'Variant Barcode': v.barcode || '',
          'Variant Inventory Qty': stockOnHand,
          'Variant Price': paisaToRupees(v.retailPrice),
          'Cost per item': paisaToRupees(v.costPrice),
          'Min Selling Price': paisaToRupees(p.minSellingPrice),
          'Reorder Level': v.reorderLevel,
          'Image Src': p.imageUrl || '',
          Status: p.isActive ? 'active' : 'draft',
        });
      }
    }

    const csvContent = objectsToCsv(headers, rows);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `catalog-export-${format}-${dateStr}.csv`;

    return {
      filename,
      rowCount: rows.length,
      csv: csvContent,
    };
  }

  /**
   * Dual-Format CSV Import (Shopify & POS Format) with atomic upsert & opening stock ledger
   */
  async importCsv(storeId: string, userId: string, dto: CsvImportDto) {
    let rawRows: Record<string, any>[] = [];

    if (dto.csvContent && dto.csvContent.trim()) {
      rawRows = parseCsvToObjects(dto.csvContent);
    } else if (dto.rows && Array.isArray(dto.rows)) {
      rawRows = dto.rows;
    } else {
      throw new BadRequestException('No CSV content or rows provided for import');
    }

    if (rawRows.length === 0) {
      throw new BadRequestException('The CSV file does not contain any data rows');
    }

    // Group rows by Handle / Title / Design Code to form parent products
    const productGroups = new Map<string, Record<string, any>[]>();

    for (const row of rawRows) {
      const title =
        row['Title'] || row['Product Name'] || row['Name'] || row['title'] || '';
      const handle =
        row['Handle'] ||
        row['handle'] ||
        row['Design Code'] ||
        row['Style Code'] ||
        title;

      if (!title.trim() && !handle.trim()) continue;

      const groupKey = (handle || title).trim().toLowerCase();
      if (!productGroups.has(groupKey)) {
        productGroups.set(groupKey, []);
      }
      productGroups.get(groupKey)!.push(row);
    }

    let productsCreated = 0;
    let productsUpdated = 0;
    let variantsProcessed = 0;
    let openingUnitsLogged = 0;
    const errors: string[] = [];

    // Execute in Prisma transaction
    await this.prisma.$transaction(async (tx) => {
      for (const [groupKey, rows] of productGroups.entries()) {
        try {
          const firstRow = rows[0];
          const name =
            (
              firstRow['Title'] ||
              firstRow['Product Name'] ||
              firstRow['Name'] ||
              firstRow['title'] ||
              'Untitled Product'
            ).trim();

          const styleCode =
            (
              firstRow['Design Code'] ||
              firstRow['Style Code'] ||
              firstRow['styleCode'] ||
              ''
            ).trim() || null;

          const categoryName = (
            firstRow['Product Category'] ||
            firstRow['Type'] ||
            firstRow['Category'] ||
            'General'
          ).trim();

          const subCategory = (
            firstRow['Sub-Category'] ||
            firstRow['SubCategory'] ||
            firstRow['Tags'] ||
            ''
          ).trim() || null;

          const brand = (
            firstRow['Vendor'] ||
            firstRow['Brand'] ||
            firstRow['brand'] ||
            ''
          ).trim() || null;

          const season = (firstRow['Season'] || firstRow['season'] || '').trim() || null;
          const imageUrl = (firstRow['Image Src'] || firstRow['Image'] || '').trim() || null;
          const handle = (firstRow['Handle'] || groupKey).trim();

          // Resolve Category
          let category = await tx.category.findFirst({
            where: { storeId, name: { equals: categoryName, mode: 'insensitive' } },
          });
          if (!category) {
            category = await tx.category.create({
              data: { storeId, name: categoryName },
            });
          }

          // Parse minSellingPrice
          const rawMinPrice =
            Number(firstRow['Min Selling Price'] || firstRow['Variant Compare At Price']) || 0;
          const minSellingPricePaisas = rupeesToPaisa(rawMinPrice);

          // Find or create Parent Product
          let product = await tx.product.findFirst({
            where: {
              storeId,
              OR: [
                { handle },
                { name: { equals: name, mode: 'insensitive' } },
                ...(styleCode ? [{ styleCode }] : []),
              ],
            },
          });

          if (!product) {
            product = await tx.product.create({
              data: {
                storeId,
                categoryId: category.id,
                name,
                styleCode,
                subCategory,
                brand,
                season,
                minSellingPrice: minSellingPricePaisas,
                imageUrl,
                handle,
              },
            });
            productsCreated++;
          } else {
            product = await tx.product.update({
              where: { id: product.id },
              data: {
                ...(styleCode ? { styleCode } : {}),
                ...(subCategory ? { subCategory } : {}),
                ...(brand ? { brand } : {}),
                ...(season ? { season } : {}),
                ...(imageUrl ? { imageUrl } : {}),
                ...(minSellingPricePaisas > 0n ? { minSellingPrice: minSellingPricePaisas } : {}),
              },
            });
            productsUpdated++;
          }

          // Process each variant under this product
          for (const row of rows) {
            // Option extraction (Shopify Option1/Option2 vs Direct Color/Size)
            let color = (row['Color'] || row['Colour'] || '').trim();
            let size = (row['Size'] || '').trim();

            const opt1Name = (row['Option1 Name'] || '').toLowerCase();
            const opt1Val = (row['Option1 Value'] || '').trim();
            const opt2Name = (row['Option2 Name'] || '').toLowerCase();
            const opt2Val = (row['Option2 Value'] || '').trim();

            if (!color) {
              if (opt1Name.includes('col') || opt1Name.includes('shade')) color = opt1Val;
              else if (opt2Name.includes('col') || opt2Name.includes('shade')) color = opt2Val;
            }
            if (!size) {
              if (opt1Name.includes('size')) size = opt1Val;
              else if (opt2Name.includes('size')) size = opt2Val;
            }
            if (!color && opt1Val && opt1Val.toLowerCase() !== 'default title') color = opt1Val;
            if (!size && opt2Val) size = opt2Val;

            // Price parsing
            const retailPriceRupees =
              Number(row['Variant Price'] || row['Price'] || row['Retail Price']) || 0;
            let costPriceRupees =
              Number(row['Cost per item'] || row['Cost'] || row['Cost Price']) || 0;

            // Default cost to 70% of retail if omitted
            if (costPriceRupees === 0 && retailPriceRupees > 0) {
              costPriceRupees = Math.round(retailPriceRupees * 0.7);
            }

            const openingStock =
              parseInt(row['Variant Inventory Qty'] || row['Stock'] || row['On Hand'] || '0', 10) || 0;
            const reorderLevel =
              parseInt(row['Reorder Level'] || '3', 10) || 3;

            // SKU extraction or fallback generation
            let sku = (row['Variant SKU'] || row['SKU'] || '').trim();
            if (!sku) {
              const prefix = styleCode || name.substring(0, 4).toUpperCase();
              const cTag = (color || 'STD').substring(0, 3).toUpperCase();
              const sTag = (size || 'U').substring(0, 2).toUpperCase();
              sku = `${prefix}-${cTag}-${sTag}`;
            }

            // Barcode extraction or auto-generation
            let barcode = (row['Variant Barcode'] || row['Barcode'] || '').trim() || null;
            if (!barcode) {
              barcode = generateEan13Barcode('8964');
            }

            // Check if variant exists
            const existingVariant = await tx.productVariant.findUnique({
              where: { storeId_sku: { storeId, sku } },
              include: { inventory: { where: { storeId } } },
            });

            if (existingVariant) {
              await tx.productVariant.update({
                where: { id: existingVariant.id },
                data: {
                  color: color || existingVariant.color,
                  size: size || existingVariant.size,
                  costPrice: rupeesToPaisa(costPriceRupees),
                  retailPrice: rupeesToPaisa(retailPriceRupees),
                  reorderLevel,
                  ...(barcode && !existingVariant.barcode ? { barcode } : {}),
                },
              });
            } else {
              const newVariant = await tx.productVariant.create({
                data: {
                  storeId,
                  productId: product.id,
                  sku,
                  barcode,
                  color: color || null,
                  size: size || null,
                  costPrice: rupeesToPaisa(costPriceRupees),
                  retailPrice: rupeesToPaisa(retailPriceRupees),
                  reorderLevel,
                },
              });

              await tx.storeInventory.create({
                data: {
                  storeId,
                  variantId: newVariant.id,
                  quantityOnHand: Math.max(0, openingStock),
                  lowStockThreshold: reorderLevel,
                },
              });

              if (openingStock > 0) {
                await tx.stockMovement.create({
                  data: {
                    storeId,
                    variantId: newVariant.id,
                    type: StockMovementType.OPENING_STOCK,
                    quantity: openingStock,
                    previousQty: 0,
                    newQty: openingStock,
                    note: 'Shopify/CSV import opening stock',
                    performedByUserId: userId,
                  },
                });
                openingUnitsLogged += openingStock;
              }
            }

            variantsProcessed++;
          }
        } catch (err: any) {
          errors.push(`Group "${groupKey}": ${err.message || 'Error processing row'}`);
        }
      }
    });

    return {
      productsCreated,
      productsUpdated,
      variantsProcessed,
      openingUnitsLogged,
      errors,
    };
  }
}
