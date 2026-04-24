import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import { MailService } from '../mail/mail.service';
import {
  fetchAllBioherbsProducts,
  fetchBioherbsProducts,
  fetchBioherbsProductByHandle,
} from './scraper/bioherbs.scraper';
import { submitBioherbsOrderWithPuppeteer } from './bioherbs-checkout.puppeteer';
import {
  ExternalWebsite,
  ExternalWebsiteDocument,
} from './schemas/external-website.schema';
import {
  ExternalProduct,
  ExternalProductDocument,
} from './schemas/external-product.schema';
import {
  IntegrationOrder,
  IntegrationOrderDocument,
} from './schemas/integration-order.schema';

const BIOHERBS_SLUG = 'bioherbs';
const BIOHERBS_BASE = 'https://www.bioherbs.tn';

@Injectable()
export class IntegrationsService implements OnModuleInit {
  private readonly logger = new Logger(IntegrationsService.name);
  private readonly maxOrderFormEntries = 20;
  private readonly maxOrderFormKeyLength = 64;
  private readonly maxOrderFormValueLength = 500;

  constructor(
    @InjectModel(ExternalWebsite.name)
    private readonly websiteModel: Model<ExternalWebsiteDocument>,
    @InjectModel(ExternalProduct.name)
    private readonly productModel: Model<ExternalProductDocument>,
    @InjectModel(IntegrationOrder.name)
    private readonly orderModel: Model<IntegrationOrderDocument>,
    private readonly mailService: MailService,
  ) {}

  async onModuleInit() {
    await this.websiteModel.deleteMany({ slug: 'books-to-scrape' }).exec();
    const exists = await this.websiteModel
      .findOne({ slug: BIOHERBS_SLUG })
      .exec();
    if (!exists) {
      await this.websiteModel.create({
        slug: BIOHERBS_SLUG,
        name: 'BioHerbs',
        baseUrl: BIOHERBS_BASE,
        isActive: true,
        refreshIntervalMinutes: 60,
      });
      this.logger.log('Registered external website: BioHerbs');
    }
  }

  async listWebsites(): Promise<ExternalWebsite[]> {
    return this.websiteModel
      .find({ isActive: true, slug: BIOHERBS_SLUG })
      .sort({ name: 1 })
      .lean()
      .exec();
  }

  async getWebsite(slug: string): Promise<ExternalWebsite> {
    const doc = await this.websiteModel
      .findOne({ slug, isActive: true })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException(`Website ${slug} not found`);
    return doc as ExternalWebsite;
  }

  /**
   * Catalogue pour un site intégré (BioHerbs uniquement).
   */
  async getCatalog(
    websiteSlug: string,
    categorySlug?: string,
    page?: number,
    forceRefresh?: boolean,
  ): Promise<{
    categories: Array<{ name: string; slug: string; url: string }>;
    products: Array<{
      externalId: string;
      name: string;
      price: string;
      availability: boolean;
      category: string;
      productUrl: string;
      imageUrls: string[];
    }>;
  }> {
    const website = await this.getWebsite(websiteSlug);
    const websiteId = (website as unknown as { _id: Types.ObjectId })._id;
    const limit = 20;
    const skip = ((page ?? 1) - 1) * limit;

    if (websiteSlug !== BIOHERBS_SLUG) {
      throw new NotFoundException(`Website ${websiteSlug} not supported`);
    }

    if ((page ?? 1) === 1 && forceRefresh) {
      await this.productModel.deleteMany({ websiteId }).exec();
    }
    let products = await this.productModel
      .find({ websiteId })
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
    if (products.length === 0 && (page ?? 1) === 1) {
      await this.syncBioherbsCatalog(websiteId);
      products = await this.productModel
        .find({ websiteId })
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec();
    }
    const categories = [
      {
        name: 'Nos produits',
        slug: 'nos-produits',
        url: `${BIOHERBS_BASE}/collections/nos-produits`,
      },
    ];
    return {
      categories,
      products: products.map((p) => ({
        externalId: p.externalId,
        name: p.name,
        price: p.price,
        availability: p.availability,
        category: p.category,
        productUrl: p.productUrl,
        imageUrls: p.imageUrls ?? [],
      })),
    };
  }

  private async syncBioherbsCatalog(websiteId: Types.ObjectId): Promise<void> {
    const list = await fetchAllBioherbsProducts();
    for (const item of list) {
      await this.productModel
        .findOneAndUpdate(
          { websiteId, externalId: item.externalId },
          {
            $set: {
              websiteId,
              externalId: item.externalId,
              name: item.name,
              price: item.price,
              availability: item.availability,
              category: item.category,
              productUrl: item.productUrl,
              imageUrls: item.imageUrls ?? [],
              lastScrapedAt: new Date(),
            },
          },
          { upsert: true },
        )
        .exec();
    }
    this.logger.log(`Synced ${list.length} products for BioHerbs`);
  }

  async getProduct(
    websiteSlug: string,
    externalId: string,
  ): Promise<ExternalProduct & { lastScrapedAt?: Date }> {
    if (websiteSlug !== BIOHERBS_SLUG) {
      throw new NotFoundException(`Website ${websiteSlug} not supported`);
    }
    const website = await this.getWebsite(websiteSlug);
    const websiteId = (website as unknown as { _id: Types.ObjectId })._id;
    const product = await this.productModel
      .findOne({ websiteId, externalId })
      .lean()
      .exec();
    if (product) return product as ExternalProduct & { lastScrapedAt?: Date };
    const list = await fetchBioherbsProducts(1, 100);
    const found = list.products.find((p) => p.externalId === externalId);
    if (!found) throw new NotFoundException('Product not found');
    const created = await this.productModel
      .findOneAndUpdate(
        { websiteId, externalId: found.externalId },
        {
          $set: {
            websiteId,
            externalId: found.externalId,
            name: found.name,
            price: found.price,
            availability: found.availability,
            category: found.category,
            productUrl: found.productUrl,
            imageUrls: found.imageUrls ?? [],
            lastScrapedAt: new Date(),
          },
        },
        { upsert: true, new: true },
      )
      .lean()
      .exec();
    return created as ExternalProduct & { lastScrapedAt?: Date };
  }

  /**
   * Refresh a single product from the live site (e.g. on user view).
   */
  async refreshProduct(
    websiteSlug: string,
    externalId: string,
  ): Promise<ExternalProduct & { lastScrapedAt?: Date }> {
    if (websiteSlug !== BIOHERBS_SLUG) {
      throw new NotFoundException(`Website ${websiteSlug} not supported`);
    }
    return this.getProduct(websiteSlug, externalId);
  }

  /**
   * Enregistre la commande en base puis l'envoie au site cible (sans ouvrir le site dans le navigateur).
   */
  async submitOrder(
    websiteSlug: string,
    payload: {
      externalId: string;
      quantity?: number;
      productName?: string;
      formData: Record<string, string>;
    },
  ): Promise<{
    orderId: string;
    status: string;
    sentToSiteAt: Date | null;
    message: string;
    cartUrl?: string;
  }> {
    const website = await this.getWebsite(websiteSlug);
    const websiteId = (website as unknown as { _id: Types.ObjectId })._id;
    const externalId = this.sanitizeOrderText(payload.externalId, 120);
    if (!externalId) {
      throw new BadRequestException('Product identifier is required');
    }
    const productName = this.sanitizeOrderText(payload.productName, 200);
    const quantity = this.normalizeQuantity(payload.quantity);
    const formData = this.sanitizeOrderFormData(payload.formData);

    const order = await this.orderModel.create({
      websiteId,
      externalId,
      productName,
      quantity,
      formData,
      status: 'received',
    });

    const orderIdStr = order._id.toString();
    await this.mailService.sendOrderToCogniCare({
      orderId: orderIdStr,
      productName: order.productName,
      quantity: order.quantity,
      price: formData.price,
      formData,
    });

    const customerEmail = formData.email?.trim();
    const isBioherbs = websiteSlug === BIOHERBS_SLUG;
    // Pour BioHerbs, on n'envoie pas l'email CogniCare "Commande enregistrée" ; on enverra après Puppeteer un email indiquant que la confirmation viendra de BioHerbs.
    if (customerEmail && !isBioherbs) {
      await this.mailService.sendOrderConfirmationToCustomer(customerEmail, {
        orderId: orderIdStr,
        productName: order.productName,
        quantity: order.quantity,
      });
    }

    const websiteDoc = await this.websiteModel
      .findOne({ slug: websiteSlug })
      .lean()
      .exec();
    const formActionUrl = websiteDoc?.formActionUrl?.trim();

    try {
      if (websiteSlug === BIOHERBS_SLUG) {
        const product = await fetchBioherbsProductByHandle(payload.externalId);
        if (product) {
          this.logger.log(
            `BioHerbs: submitting order ${String(order._id)} via Puppeteer (variant ${product.variantId})`,
          );
          const result = await submitBioherbsOrderWithPuppeteer({
            variantId: product.variantId,
            quantity: quantity ?? order.quantity ?? 1,
            formData,
          });
          if (result.success) {
            order.sentToSiteAt = new Date();
            order.status = 'sent';
            if (result.externalOrderId) {
              order.externalOrderId = result.externalOrderId;
            }
            await order.save();
            this.logger.log(
              `BioHerbs: order ${String(order._id)} submitted successfully. External order #${result.externalOrderId ?? 'n/a'}. ` +
                'Customer should receive BioHerbs confirmation email.',
            );
          } else {
            this.logger.warn(
              `BioHerbs Puppeteer failed for order ${String(order._id)}. No BioHerbs email will be sent. Error: ${result.error}`,
            );
          }
          // Email client BioHerbs : indique que la confirmation viendra de BioHerbs (pas CogniCare).
          if (customerEmail) {
            await this.mailService.sendBioherbsOrderConfirmationToCustomer(
              customerEmail,
              {
                orderId: orderIdStr,
                productName: order.productName,
                quantity: order.quantity,
                sentToBioherbs: result.success,
              },
            );
          }
        } else {
          this.logger.warn(
            `BioHerbs: product handle "${payload.externalId}" not found, skipping Puppeteer submission`,
          );
          if (customerEmail) {
            await this.mailService.sendBioherbsOrderConfirmationToCustomer(
              customerEmail,
              {
                orderId: orderIdStr,
                productName: order.productName,
                quantity: order.quantity,
                sentToBioherbs: false,
              },
            );
          }
        }
      } else if (formActionUrl) {
        await this.sendOrderToExternalSite(
          websiteDoc as ExternalWebsite & { _id: Types.ObjectId },
          order,
          {
            externalId,
            productName,
            quantity,
            formData,
          },
        );
        order.sentToSiteAt = new Date();
        order.status = 'sent';
        await order.save();
      }
    } catch (e) {
      this.logger.warn(
        `Order ${String(order._id)} saved but send to site failed: ${(e as Error).message}`,
      );
    }

    const sentAt = order.sentToSiteAt ?? null;
    const message =
      order.status === 'sent'
        ? 'Commande enregistrée et envoyée. Le marchand vous contactera pour la livraison.'
        : 'Commande enregistrée. Elle sera traitée sous peu.';

    return {
      orderId: order._id.toString(),
      status: order.status,
      sentToSiteAt: sentAt,
      message,
    };
  }

  private sanitizeOrderText(
    value: string | undefined,
    maxLength: number,
  ): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  private normalizeQuantity(quantity: number | undefined): number {
    const normalized = Number.isInteger(quantity) ? Number(quantity) : 1;
    return Math.max(1, Math.min(normalized, 20));
  }

  private sanitizeOrderFormData(
    formData: Record<string, string> | undefined,
  ): Record<string, string> {
    if (!formData || typeof formData !== 'object' || Array.isArray(formData)) {
      return {};
    }

    const sanitizedEntries = Object.entries(formData)
      .slice(0, this.maxOrderFormEntries)
      .flatMap(([rawKey, rawValue]) => {
        if (typeof rawValue !== 'string') {
          return [];
        }

        const key = this.sanitizeOrderText(rawKey, this.maxOrderFormKeyLength);
        if (!key) {
          return [];
        }

        return [
          [
            key,
            this.sanitizeOrderText(rawValue, this.maxOrderFormValueLength),
          ] as const,
        ];
      });

    return Object.fromEntries(sanitizedEntries);
  }

  /**
   * Envoi réel de la commande vers le site : POST du formulaire vers formActionUrl.
   * Utilise formFieldMapping pour mapper nos champs (fullName, email, …) vers les noms attendus par le site.
   */
  private async sendOrderToExternalSite(
    website: ExternalWebsite & { _id?: Types.ObjectId },
    order: IntegrationOrderDocument,
    payload: {
      externalId: string;
      quantity?: number;
      productName?: string;
      formData: Record<string, string>;
    },
  ): Promise<void> {
    const formActionUrl = website.formActionUrl?.trim();
    if (!formActionUrl) return;

    const formData = payload.formData ?? {};
    const mapping = website.formFieldMapping;
    const params = new URLSearchParams();

    if (mapping?.length) {
      for (const m of mapping) {
        const value = formData[m.appFieldName] ?? '';
        params.append(m.siteSelector, value);
      }
    } else {
      for (const [k, v] of Object.entries(formData)) {
        params.append(k, String(v ?? ''));
      }
    }

    params.append('productId', payload.externalId);
    params.append(
      'productName',
      payload.productName ?? order.productName ?? '',
    );
    params.append('quantity', String(payload.quantity ?? order.quantity ?? 1));

    await axios
      .post(formActionUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err)
          ? `${err.response?.status ?? err.code}: ${err.message}`
          : (err as Error).message;
        throw new Error(`Envoi au site échoué: ${msg}`);
      });

    this.logger.log(
      `Order ${String(order._id)} sent to site ${website.slug} (${formActionUrl})`,
    );
  }
}
