import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { SeoToolName, SeoToolStatusState } from '../admin-seo.constants';
import { GithubActionsConfig } from '../schemas/seo-control-config.schema';

export interface SeoToolStatus {
  tool: SeoToolName;
  status: SeoToolStatusState;
  lastSuccessfulRunAt?: string;
  lastErrorSummary?: string;
}

interface GithubDispatchRequest {
  workflowId: string;
  repository: string;
  branch: string;
  inputs?: Record<string, string>;
}

@Injectable()
export class GithubActionsConnector {
  getStatus(config?: Partial<GithubActionsConfig> | null): SeoToolStatus {
    if (!config) {
      return {
        tool: SeoToolName.GITHUB_ACTIONS,
        status: SeoToolStatusState.DISABLED,
      };
    }

    const hasAnyConfig = Boolean(
      config.repository ||
      config.lighthouseWorkflowId ||
      config.zapWorkflowId ||
      config.tokenSecretRef,
    );

    if (!hasAnyConfig) {
      return {
        tool: SeoToolName.GITHUB_ACTIONS,
        status: SeoToolStatusState.DISABLED,
      };
    }

    if (!config.repository || !config.tokenSecretRef) {
      return {
        tool: SeoToolName.GITHUB_ACTIONS,
        status: SeoToolStatusState.DEGRADED,
        lastErrorSummary: 'Repository or token reference is missing.',
      };
    }

    if (!process.env[config.tokenSecretRef]) {
      return {
        tool: SeoToolName.GITHUB_ACTIONS,
        status: SeoToolStatusState.DEGRADED,
        lastErrorSummary:
          'Referenced GitHub token is not available in the runtime environment.',
      };
    }

    return {
      tool: SeoToolName.GITHUB_ACTIONS,
      status: SeoToolStatusState.CONNECTED,
    };
  }

  async dispatchWorkflow(
    request: GithubDispatchRequest,
    config?: Partial<GithubActionsConfig> | null,
  ): Promise<{ success: boolean; summary: string; errorCode?: string }> {
    const status = this.getStatus(config);
    if (status.status !== SeoToolStatusState.CONNECTED || !config) {
      return {
        success: false,
        summary: status.lastErrorSummary ?? 'GitHub Actions is not configured.',
        errorCode: 'GITHUB_NOT_CONFIGURED',
      };
    }

    const tokenRef = config.tokenSecretRef;
    const token = tokenRef ? process.env[tokenRef] : undefined;
    if (!token) {
      return {
        success: false,
        summary: 'GitHub token reference is not available at runtime.',
        errorCode: 'GITHUB_MISSING_TOKEN',
      };
    }

    const encodedRepository = encodeURIComponent(request.repository);
    const url = `https://api.github.com/repos/${encodedRepository}/actions/workflows/${encodeURIComponent(request.workflowId)}/dispatches`;

    try {
      await axios.post(
        url,
        {
          ref: request.branch,
          inputs: request.inputs ?? {},
        },
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          timeout: 10000,
        },
      );

      return {
        success: true,
        summary: `Workflow ${request.workflowId} dispatched successfully.`,
      };
    } catch (error) {
      return {
        success: false,
        summary: this.sanitizeError(error),
        errorCode: 'GITHUB_DISPATCH_FAILED',
      };
    }
  }

  private sanitizeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      return status
        ? `GitHub Actions request failed with HTTP ${status}.`
        : 'GitHub Actions request failed.';
    }

    return 'GitHub Actions request failed.';
  }
}
