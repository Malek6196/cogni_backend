import { Controller, Get, Redirect } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Welcome endpoint',
    description: 'Returns a welcome message for the CogniCare API',
  })
  @ApiResponse({
    status: 200,
    description: 'Welcome message',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Welcome to CogniCare API v1.0' },
        timestamp: { type: 'string', format: 'date-time' },
        documentation: { type: 'string', example: '/api' },
      },
    },
  })
  getWelcome() {
    return {
      message: 'Welcome to CogniCare API v1.0',
      timestamp: new Date().toISOString(),
      documentation: '/api',
    };
  }

  @Get('api')
  @Redirect('/api', 302)
  @ApiOperation({
    summary: 'API Documentation redirect',
    description: 'Redirects to Swagger API documentation',
  })
  getApiDocs() {
    // This will redirect to /api where Swagger is set up
  }

  @Get('health')
  @ApiOperation({
    summary: 'Health check endpoint',
    description: 'Returns service health status for monitoring',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', format: 'date-time' },
        version: { type: 'string', example: '1.0.0' },
      },
    },
  })
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
    };
  }
}
