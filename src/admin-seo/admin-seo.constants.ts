export const DEFAULT_CRAWLER_AGENTS = ['Googlebot', 'Bingbot', '*'] as const;
export const DEFAULT_PUBLIC_ROUTES = [
  '/',
  '/admin/login',
  '/org/login',
  '/specialist/login',
] as const;

export const PRIVATE_PATH_PREFIXES = [
  '/admin/dashboard',
  '/org/dashboard',
  '/specialist/dashboard',
  '/api',
] as const;

export enum SeoActionType {
  REGENERATE_SITEMAP = 'REGENERATE_SITEMAP',
  VALIDATE_ROBOTS_RULES = 'VALIDATE_ROBOTS_RULES',
  SUBMIT_SITEMAP = 'SUBMIT_SITEMAP',
  INSPECT_URL_COVERAGE = 'INSPECT_URL_COVERAGE',
  REQUEST_INDEXING = 'REQUEST_INDEXING',
  TRIGGER_LIGHTHOUSE_SCAN = 'TRIGGER_LIGHTHOUSE_SCAN',
  TRIGGER_ZAP_SCAN = 'TRIGGER_ZAP_SCAN',
  TRIGGER_JENKINS_BUILD = 'TRIGGER_JENKINS_BUILD',
}

export enum SeoJobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum SeoToolName {
  GITHUB_ACTIONS = 'github_actions',
  JENKINS = 'jenkins',
  SEARCH_CONSOLE = 'search_console',
  LIGHTHOUSE = 'lighthouse',
  ZAP = 'zap',
  SENTRY = 'sentry',
}

export enum SeoToolStatusState {
  CONNECTED = 'CONNECTED',
  DEGRADED = 'DEGRADED',
  DISABLED = 'DISABLED',
  ERROR = 'ERROR',
}
