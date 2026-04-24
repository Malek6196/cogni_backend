import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { IntegrationsService } from './integrations.service';
import { ExternalWebsite } from './schemas/external-website.schema';
import { ExternalProduct } from './schemas/external-product.schema';
import { SubmitOrderDto } from './dto/submit-order.dto';

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Public()
  @Get('websites')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'List integrated e-commerce websites' })
  @ApiResponse({
    status: 200,
    description: 'List of websites (e.g. Books to Scrape, Bioherbs)',
  })
  listWebsites(): Promise<ExternalWebsite[]> {
    return this.integrationsService.listWebsites();
  }

  @Public()
  @Get('websites/:slug')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Get one website config' })
  getWebsite(@Param('slug') slug: string): Promise<ExternalWebsite> {
    return this.integrationsService.getWebsite(slug);
  }

  @Public()
  @Get('websites/:slug/catalog')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get catalog (categories + products) for a website',
  })
  @ApiResponse({
    status: 200,
    description: 'Categories and paginated products',
  })
  async getCatalog(
    @Param('slug') slug: string,
    @Query('category') categorySlug?: string,
    @Query('page') page?: string,
    @Query('refresh') refresh?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const forceRefresh = refresh === '1' || refresh === 'true';
    return this.integrationsService.getCatalog(
      slug,
      categorySlug,
      pageNum,
      forceRefresh,
    );
  }

  @Public()
  @Get('websites/:slug/products/:externalId')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Get product detail' })
  async getProduct(
    @Param('slug') slug: string,
    @Param('externalId') externalId: string,
  ): Promise<ExternalProduct> {
    return this.integrationsService.getProduct(slug, externalId);
  }

  @Public()
  @Get('websites/:slug/products/:externalId/refresh')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Refresh product data from the live site' })
  async refreshProduct(
    @Param('slug') slug: string,
    @Param('externalId') externalId: string,
  ): Promise<ExternalProduct> {
    return this.integrationsService.refreshProduct(slug, externalId);
  }

  @Public()
  @Post('websites/:slug/orders')
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  @ApiOperation({
    summary: 'Submit order (in-app form → saved then sent to site)',
  })
  @ApiResponse({ status: 201, description: 'Order received and sent to site' })
  async submitOrder(
    @Param('slug') slug: string,
    @Body() body: SubmitOrderDto,
  ): Promise<{
    orderId: string;
    status: string;
    sentToSiteAt: Date | null;
    message: string;
  }> {
    return this.integrationsService.submitOrder(slug, {
      externalId: body.externalId,
      quantity: body.quantity,
      productName: body.productName,
      formData: body.formData,
    });
  }
}
