import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';
    let errorName = 'Internal Server Error';

    // 1. Handle NestJS HTTP Exceptions
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
        errorName = exception.name;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, any>;
        message = resObj.message || exception.message;
        errorName = resObj.error || exception.name;
      }
    }
    // 2. Handle Prisma Known Request Errors
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          status = HttpStatus.CONFLICT;
          errorName = 'Conflict';
          const target = (exception.meta?.target as string[]) || [];
          message = `A record with this ${target.length ? target.join(', ') : 'unique constraint'} already exists.`;
          break;
        }
        case 'P2025': {
          status = HttpStatus.NOT_FOUND;
          errorName = 'Not Found';
          message = 'The requested record was not found or has been removed.';
          break;
        }
        case 'P2003': {
          status = HttpStatus.BAD_REQUEST;
          errorName = 'Bad Request';
          message = 'Relational constraint failure: Referenced entity does not exist.';
          break;
        }
        case 'P2014': {
          status = HttpStatus.BAD_REQUEST;
          errorName = 'Bad Request';
          message = 'The requested change violates a required relation.';
          break;
        }
        default: {
          status = HttpStatus.BAD_REQUEST;
          errorName = 'Bad Request';
          message = `Database operation error [${exception.code}].`;
          break;
        }
      }
    }
    // 3. Handle Prisma Validation Errors
    else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      errorName = 'Validation Error';
      message = 'Invalid data provided to database operation.';
    }
    // 4. Handle Standard Javascript Errors
    else if (exception instanceof Error) {
      message = exception.message;
      errorName = exception.name;
    }

    this.logger.error(
      `[${request.method}] ${request.url} - Status: ${status} - Error: ${JSON.stringify(
        message,
      )}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json({
      success: false,
      statusCode: status,
      error: errorName,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
