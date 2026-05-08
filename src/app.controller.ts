import { Controller, Get, Header, Redirect } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

const privacyPolicyHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CogniCare Privacy Policy</title>
    <style>
      body {
        color: #1f2937;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
        line-height: 1.65;
        margin: 0 auto;
        max-width: 760px;
        padding: 40px 20px;
      }
      h1,
      h2 {
        color: #111827;
        line-height: 1.2;
      }
      a {
        color: #2563eb;
      }
      .updated {
        color: #6b7280;
      }
    </style>
  </head>
  <body>
    <h1>CogniCare Privacy Policy</h1>
    <p class="updated">Effective May 6, 2026</p>
    <p>
      CogniCare is designed for autism and special needs care coordination. We
      collect only the data needed to provide accounts, care plans,
      communication, progress tracking, organization management, and safety
      features.
    </p>

    <h2>Data We Process</h2>
    <p>
      We may process account details, role and organization membership, family
      and child profiles, care notes, progress data, messages, appointments,
      volunteer training records, uploaded documents, support requests, and app
      diagnostics needed to operate the service.
    </p>

    <h2>Camera, Microphone, Photos, and Location</h2>
    <p>
      Camera and photo access are used only when a user chooses to upload
      images, proof photos, profile media, documents, or participate in
      camera-enabled features. Microphone access is used for voice notes and
      calls. Location access supports map and nearby-service features when
      enabled by the user.
    </p>

    <h2>Health and Child Data</h2>
    <p>
      Health, development, child, family, and care data is restricted by
      role-based access controls. Families, assigned specialists, organization
      leaders, caregivers, and admins can only access information required for
      their authorized workflow.
    </p>

    <h2>Security and Retention</h2>
    <p>
      Sensitive app traffic is sent over HTTPS. Authentication tokens are
      protected on supported devices. We retain data while accounts are active
      or as needed for legal, safety, support, and service integrity purposes.
    </p>

    <h2>Deletion and User Rights</h2>
    <p>
      Users can request account deletion, data correction, export, or privacy
      support by contacting
      <a href="mailto:privacy@cognicare.app">privacy@cognicare.app</a>.
    </p>

    <h2>Contact</h2>
    <p>
      For privacy questions, contact
      <a href="mailto:privacy@cognicare.app">privacy@cognicare.app</a>.
    </p>
  </body>
</html>`;

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

  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({
    summary: 'Public privacy policy',
    description:
      'Returns the public privacy policy page required by app stores.',
  })
  @ApiResponse({
    status: 200,
    description: 'Privacy policy HTML page',
    content: {
      'text/html': {
        schema: {
          type: 'string',
        },
      },
    },
  })
  getPrivacyPolicy(): string {
    return privacyPolicyHtml;
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
