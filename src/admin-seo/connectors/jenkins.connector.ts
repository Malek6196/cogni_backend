import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { SeoToolName, SeoToolStatusState } from '../admin-seo.constants';
import { JenkinsConfig } from '../schemas/seo-control-config.schema';
import type { SeoToolStatus } from './github-actions.connector';

@Injectable()
export class JenkinsConnector {
  getStatus(config?: Partial<JenkinsConfig> | null): SeoToolStatus {
    if (!config) {
      return { tool: SeoToolName.JENKINS, status: SeoToolStatusState.DISABLED };
    }

    const hasAnyConfig = Boolean(
      config.baseUrl ||
      config.jobName ||
      config.usernameSecretRef ||
      config.apiTokenSecretRef,
    );

    if (!hasAnyConfig) {
      return { tool: SeoToolName.JENKINS, status: SeoToolStatusState.DISABLED };
    }

    if (!config.baseUrl || !config.jobName) {
      return {
        tool: SeoToolName.JENKINS,
        status: SeoToolStatusState.DEGRADED,
        lastErrorSummary: 'Jenkins base URL or job name is missing.',
      };
    }

    const username = config.usernameSecretRef
      ? process.env[config.usernameSecretRef]
      : undefined;
    const apiToken = config.apiTokenSecretRef
      ? process.env[config.apiTokenSecretRef]
      : undefined;

    if (!username || !apiToken) {
      return {
        tool: SeoToolName.JENKINS,
        status: SeoToolStatusState.DEGRADED,
        lastErrorSummary:
          'Referenced Jenkins credentials are not available in the runtime environment.',
      };
    }

    return { tool: SeoToolName.JENKINS, status: SeoToolStatusState.CONNECTED };
  }

  async triggerBuild(
    params: { baseUrl: string; jobName: string; targetUrl: string },
    config?: Partial<JenkinsConfig> | null,
  ): Promise<{ success: boolean; summary: string; errorCode?: string }> {
    const status = this.getStatus(config);
    if (status.status !== SeoToolStatusState.CONNECTED || !config) {
      return {
        success: false,
        summary: status.lastErrorSummary ?? 'Jenkins is not configured.',
        errorCode: 'JENKINS_NOT_CONFIGURED',
      };
    }

    const usernameRef = config.usernameSecretRef;
    const tokenRef = config.apiTokenSecretRef;
    const username = usernameRef ? process.env[usernameRef] : undefined;
    const apiToken = tokenRef ? process.env[tokenRef] : undefined;
    if (!username || !apiToken) {
      return {
        success: false,
        summary: 'Jenkins credentials are not available at runtime.',
        errorCode: 'JENKINS_MISSING_CREDENTIALS',
      };
    }

    const url = `${params.baseUrl.replace(/\/$/, '')}/job/${encodeURIComponent(params.jobName)}/buildWithParameters`;
    const authToken = Buffer.from(`${username}:${apiToken}`).toString('base64');

    try {
      await axios.post(url, null, {
        params: { TARGET_URL: params.targetUrl },
        headers: { Authorization: `Basic ${authToken}` },
        timeout: 10000,
      });

      return {
        success: true,
        summary: `Jenkins job ${params.jobName} triggered successfully.`,
      };
    } catch (error) {
      const statusCode = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      return {
        success: false,
        summary: statusCode
          ? `Jenkins trigger failed with HTTP ${statusCode}.`
          : 'Jenkins trigger failed.',
        errorCode: 'JENKINS_TRIGGER_FAILED',
      };
    }
  }
}
