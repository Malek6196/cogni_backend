import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { SeoToolName, SeoToolStatusState } from '../admin-seo.constants';
import { SearchConsoleConfig } from '../schemas/seo-control-config.schema';
import type { SeoToolStatus } from './github-actions.connector';

@Injectable()
export class SearchConsoleConnector {
  getStatus(config?: Partial<SearchConsoleConfig> | null): SeoToolStatus {
    if (!config) {
      return {
        tool: SeoToolName.SEARCH_CONSOLE,
        status: SeoToolStatusState.DISABLED,
      };
    }

    const hasAnyConfig = Boolean(
      config.propertyUri || config.credentialsSecretRef || config.sitemapUrl,
    );

    if (!hasAnyConfig) {
      return {
        tool: SeoToolName.SEARCH_CONSOLE,
        status: SeoToolStatusState.DISABLED,
      };
    }

    if (!config.propertyUri || !config.credentialsSecretRef) {
      return {
        tool: SeoToolName.SEARCH_CONSOLE,
        status: SeoToolStatusState.DEGRADED,
        lastErrorSummary:
          'Search Console property or credentials reference is missing.',
      };
    }

    if (!process.env[config.credentialsSecretRef]) {
      return {
        tool: SeoToolName.SEARCH_CONSOLE,
        status: SeoToolStatusState.DEGRADED,
        lastErrorSummary:
          'Referenced Search Console credentials are not available in the runtime environment.',
      };
    }

    return {
      tool: SeoToolName.SEARCH_CONSOLE,
      status: SeoToolStatusState.CONNECTED,
    };
  }

  async submitSitemap(
    sitemapUrl: string,
    config?: Partial<SearchConsoleConfig> | null,
  ): Promise<{ success: boolean; summary: string; errorCode?: string }> {
    const status = this.getStatus(config);
    if (status.status !== SeoToolStatusState.CONNECTED || !config) {
      return {
        success: false,
        summary: status.lastErrorSummary ?? 'Search Console is not configured.',
        errorCode: 'SEARCH_CONSOLE_NOT_CONFIGURED',
      };
    }

    const tokenRef = config.credentialsSecretRef;
    const propertyUri = config.propertyUri;
    const accessToken = tokenRef ? process.env[tokenRef] : undefined;
    if (!accessToken) {
      return {
        success: false,
        summary:
          'Search Console credentials reference is not available at runtime.',
        errorCode: 'SEARCH_CONSOLE_MISSING_CREDENTIALS',
      };
    }

    if (!propertyUri) {
      return {
        success: false,
        summary: 'Search Console property URI is missing.',
        errorCode: 'SEARCH_CONSOLE_PROPERTY_MISSING',
      };
    }

    try {
      const response = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(propertyUri)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.ok) {
        return {
          success: false,
          summary: `Search Console sitemap submission failed with HTTP ${response.status}.`,
          errorCode: 'SEARCH_CONSOLE_SUBMIT_FAILED',
        };
      }

      return {
        success: true,
        summary: 'Sitemap submission accepted by Search Console.',
      };
    } catch (error) {
      const statusCode = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      return {
        success: false,
        summary: statusCode
          ? `Search Console sitemap submission failed with HTTP ${statusCode}.`
          : 'Search Console sitemap submission failed.',
        errorCode: 'SEARCH_CONSOLE_SUBMIT_FAILED',
      };
    }
  }

  async inspectUrl(
    inspectionUrl: string,
    config?: Partial<SearchConsoleConfig> | null,
  ): Promise<{ success: boolean; summary: string; errorCode?: string }> {
    const status = this.getStatus(config);
    if (status.status !== SeoToolStatusState.CONNECTED || !config) {
      return {
        success: false,
        summary: status.lastErrorSummary ?? 'Search Console is not configured.',
        errorCode: 'SEARCH_CONSOLE_NOT_CONFIGURED',
      };
    }

    const tokenRef = config.credentialsSecretRef;
    const propertyUri = config.propertyUri;
    const accessToken = tokenRef ? process.env[tokenRef] : undefined;
    if (!accessToken) {
      return {
        success: false,
        summary:
          'Search Console credentials reference is not available at runtime.',
        errorCode: 'SEARCH_CONSOLE_MISSING_CREDENTIALS',
      };
    }

    if (!propertyUri) {
      return {
        success: false,
        summary: 'Search Console property URI is missing.',
        errorCode: 'SEARCH_CONSOLE_PROPERTY_MISSING',
      };
    }

    try {
      await axios.post(
        'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
        {
          inspectionUrl,
          siteUrl: propertyUri,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 10000,
        },
      );

      return {
        success: true,
        summary: 'URL inspection request accepted by Search Console.',
      };
    } catch (error) {
      const statusCode = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      return {
        success: false,
        summary: statusCode
          ? `Search Console inspection failed with HTTP ${statusCode}.`
          : 'Search Console inspection failed.',
        errorCode: 'SEARCH_CONSOLE_INSPECT_FAILED',
      };
    }
  }
}
