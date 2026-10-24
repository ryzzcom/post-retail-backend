import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  userId?: string;
  sub?: string;
  storeId: string;
  email: string;
  role: Role;
  fullName?: string;
  firstName?: string | null;
  lastName?: string | null;
  isPinSet?: boolean;
}

/**
 * Custom parameter decorator to extract the authenticated user from the Request.
 * Usage:
 *   @CurrentUser() user: AuthenticatedUser
 *   @CurrentUser('id') userId: string
 */
export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthenticatedUser | 'id' | 'userId' | 'sub' | undefined,
    ctx: ExecutionContext,
  ) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as (AuthenticatedUser & Record<string, any>) | undefined;

    if (!user) {
      return null;
    }

    if (data === 'id' || data === 'userId') {
      return user.id || user.userId || user.sub;
    }

    return data ? user[data] : user;
  },
);
