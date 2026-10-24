import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response as ExpressResponse } from 'express';

export interface ResponseEnvelope<T> {
  success: boolean;
  statusCode: number;
  data: T;
  meta?: Record<string, any>;
  timestamp: string;
}

/**
 * Recursively serializes BigInt to string to prevent JSON.stringify errors
 * and preserve precision for financial minor units (PKR paisas).
 */
export function serializeBigInt<T>(data: T): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'bigint') {
    return data.toString();
  }

  if (data instanceof Date) {
    return data.toISOString();
  }

  if (Array.isArray(data)) {
    return data.map((item) => serializeBigInt(item));
  }

  if (typeof data === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = serializeBigInt(value);
    }
    return result;
  }

  return data;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ResponseEnvelope<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ResponseEnvelope<T>> {
    const httpContext = context.switchToHttp();
    const response = httpContext.getResponse<ExpressResponse>();
    const statusCode = response?.statusCode || 200;

    return next.handle().pipe(
      map((resData) => {
        // If handler returned a payload with explicit { data, meta }
        let data = resData;
        let meta: Record<string, any> | undefined;

        if (
          resData &&
          typeof resData === 'object' &&
          'data' in resData &&
          'meta' in resData
        ) {
          data = resData.data;
          meta = resData.meta;
        }

        return {
          success: true,
          statusCode,
          data: serializeBigInt(data),
          ...(meta ? { meta: serializeBigInt(meta) } : {}),
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
