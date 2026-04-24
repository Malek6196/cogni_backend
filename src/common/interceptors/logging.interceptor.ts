import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { sanitizeUrlForLogs } from '../logging/sanitize-url.util';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method, url } = request;
    const safeUrl = sanitizeUrlForLogs(url);
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const { statusCode } = response;
        const contentLength = response.get('Content-Length');

        this.logger.log(
          `${method} ${safeUrl} ${statusCode} ${Date.now() - now}ms - ${contentLength || 0} bytes`,
        );
      }),
    );
  }
}
