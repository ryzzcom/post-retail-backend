import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

export interface TenantContext {
  storeId: string;
}

/**
 * Custom parameter decorator to extract the verified tenant context.
 * Automatically inspects the authenticated user's store context or custom header.
 * Usage:
 *   @CurrentTenant() tenant: TenantContext
 *   @CurrentTenant('storeId') storeId: string
 */
export const CurrentTenant = createParamDecorator(
  (data: keyof TenantContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    const storeId = user?.storeId || request.headers['x-store-id'];

    if (!storeId) {
      throw new UnauthorizedException('Tenant context (storeId) is missing or unverified');
    }

    const tenant: TenantContext = {
      storeId,
    };

    return data ? tenant[data] : tenant;
  },
);
