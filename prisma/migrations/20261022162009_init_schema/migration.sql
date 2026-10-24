/*
  Warnings:

  - You are about to drop the column `branchId` on the `cashier_shifts` table. All the data in the column will be lost.
  - You are about to drop the column `branchId` on the `counters` table. All the data in the column will be lost.
  - You are about to drop the column `branchId` on the `expenses` table. All the data in the column will be lost.
  - You are about to drop the column `branchId` on the `held_bills` table. All the data in the column will be lost.
  - You are about to drop the column `branchId` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `branchId` on the `stock_movements` table. All the data in the column will be lost.
  - You are about to drop the column `branchId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `branch_inventory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `branches` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[storeId,code]` on the table `counters` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "branch_inventory" DROP CONSTRAINT "branch_inventory_branchId_fkey";

-- DropForeignKey
ALTER TABLE "branch_inventory" DROP CONSTRAINT "branch_inventory_storeId_fkey";

-- DropForeignKey
ALTER TABLE "branch_inventory" DROP CONSTRAINT "branch_inventory_variantId_fkey";

-- DropForeignKey
ALTER TABLE "branches" DROP CONSTRAINT "branches_storeId_fkey";

-- DropForeignKey
ALTER TABLE "cashier_shifts" DROP CONSTRAINT "cashier_shifts_branchId_fkey";

-- DropForeignKey
ALTER TABLE "counters" DROP CONSTRAINT "counters_branchId_fkey";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_branchId_fkey";

-- DropForeignKey
ALTER TABLE "held_bills" DROP CONSTRAINT "held_bills_branchId_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_branchId_fkey";

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_branchId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_branchId_fkey";

-- DropIndex
DROP INDEX "cashier_shifts_storeId_branchId_idx";

-- DropIndex
DROP INDEX "counters_branchId_code_key";

-- DropIndex
DROP INDEX "counters_storeId_branchId_idx";

-- DropIndex
DROP INDEX "expenses_storeId_branchId_idx";

-- DropIndex
DROP INDEX "held_bills_storeId_branchId_idx";

-- DropIndex
DROP INDEX "orders_storeId_branchId_idx";

-- DropIndex
DROP INDEX "stock_movements_storeId_branchId_idx";

-- AlterTable
ALTER TABLE "cashier_shifts" DROP COLUMN "branchId";

-- AlterTable
ALTER TABLE "counters" DROP COLUMN "branchId";

-- AlterTable
ALTER TABLE "expenses" DROP COLUMN "branchId";

-- AlterTable
ALTER TABLE "held_bills" DROP COLUMN "branchId";

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "branchId";

-- AlterTable
ALTER TABLE "stock_movements" DROP COLUMN "branchId";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "branchId";

-- DropTable
DROP TABLE "branch_inventory";

-- DropTable
DROP TABLE "branches";

-- CreateTable
CREATE TABLE "store_inventory" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_inventory_storeId_idx" ON "store_inventory"("storeId");

-- CreateIndex
CREATE INDEX "store_inventory_storeId_variantId_idx" ON "store_inventory"("storeId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "store_inventory_storeId_variantId_key" ON "store_inventory"("storeId", "variantId");

-- CreateIndex
CREATE INDEX "cashier_shifts_storeId_counterId_idx" ON "cashier_shifts"("storeId", "counterId");

-- CreateIndex
CREATE UNIQUE INDEX "counters_storeId_code_key" ON "counters"("storeId", "code");

-- CreateIndex
CREATE INDEX "held_bills_storeId_counterId_idx" ON "held_bills"("storeId", "counterId");

-- CreateIndex
CREATE INDEX "orders_storeId_counterId_idx" ON "orders"("storeId", "counterId");

-- AddForeignKey
ALTER TABLE "store_inventory" ADD CONSTRAINT "store_inventory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_inventory" ADD CONSTRAINT "store_inventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
