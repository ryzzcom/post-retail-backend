import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorator to bypass global authentication guards on public routes (e.g., login, health-check).
 * Usage:
 *   @Public()
 *   @Post('auth/login')
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
