import { NestFactory } from '@nestjs/core';
import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { join } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import {
  isProductionEnvironment,
  isSwaggerEnabled,
} from './common/config/runtime-security.util';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  
  // Increase body parser limit for image classification (10MB for base64 images)
  const express = await import('express');
  const ex = (express as any).default || express;
  app.use(ex.json({ limit: '10mb' }));
  app.use(ex.urlencoded({ limit: '10mb', extended: true }));
  const productionMode = isProductionEnvironment();
  const swaggerEnabled = isSwaggerEnabled();
  const metricsEnabled = process.env.METRICS_ENABLED === 'true';

  // Security headers (cross-origin allow so images can be loaded from app)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  if (productionMode) {
    (
      app.getHttpAdapter().getInstance() as {
        set(name: string, value: number): void;
      }
    ).set('trust proxy', 1);
  }

  // Serve uploaded files (e.g. profile pictures, post images, voice .m4a) at /uploads
  const uploadsPath = join(process.cwd(), 'uploads');
  app.use(
    '/uploads',
    ex.static(uploadsPath, {
      index: false,
      setHeaders: (
        res: { setHeader: (name: string, value: string) => void },
        path: string,
      ) => {
        if (path.endsWith('.m4a')) res.setHeader('Content-Type', 'audio/mp4');
      },
    }),
  );

  // Compression : ne pas toucher aux upgrades WebSocket / Engine.IO (évite conflits avec Socket.IO)
  app.use(
    (
      compression as unknown as (
        options: Record<string, unknown>,
      ) => (req: unknown, res: unknown) => unknown
    )({
      filter: (req, res) => {
        const url = (req as { url?: string }).url ?? '';
        if (
          url.startsWith('/socket.io') ||
          url.startsWith('/socket-appointments')
        ) {
          return false;
        }
        return (compression.filter as (req: unknown, res: unknown) => boolean)(
          req,
          res,
        );
      },
    }),
  );

  // Enable CORS for Flutter app and web
  const corsOriginEnv = process.env.CORS_ORIGIN;
  const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173', // Web dashboard dev server (Vite)
    'http://localhost:8080',
    'http://localhost:54200', // Flutter web dev server
    'http://localhost:54201',
    'http://localhost:54202',
    corsOriginEnv,
  ].filter(Boolean);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (mobile apps, Postman)
      if (!origin) {
        callback(null, true);
        return;
      }

      // In development, allow localhost and 127.0.0.1 (Flutter web uses random ports)
      if (
        process.env.NODE_ENV !== 'production' &&
        (origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:'))
      ) {
        callback(null, true);
        return;
      }

      // Allow multiple origins from CORS_ORIGIN (comma-separated on Render)
      if (corsOriginEnv) {
        const list = corsOriginEnv
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean);
        if (list.indexOf(origin) !== -1) {
          callback(null, true);
          return;
        }
      }

      // Check against allowed origins list
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        // Reject CORS without throwing error (prevents 500 status)
        callback(null, false);
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type,Authorization,Accept',
  });

  // Global prefix for API versioning (exclude root path for welcome endpoint)
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      ...(metricsEnabled
        ? [{ path: '/metrics', method: RequestMethod.GET }]
        : []),
    ],
  });

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Enable global validation pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger/OpenAPI documentation
  const config = new DocumentBuilder()
    .setTitle('CogniCare API')
    .setDescription(
      'Personalized cognitive health and development platform API',
    )
    .setVersion('1.0')
    .addTag('auth', 'Authentication endpoints')
    .addTag('users', 'User management')
    .addTag('health', 'Health checks')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`🚀 CogniCare API is running on port ${port}`);
  if (swaggerEnabled) {
    console.log(`📚 Swagger documentation: http://localhost:${port}/api`);
  } else if (productionMode) {
    console.log('🔒 Swagger documentation is disabled in production');
  }
}
void bootstrap();
