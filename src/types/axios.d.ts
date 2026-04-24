declare module 'axios' {
  interface AxiosRequestConfig {
    timeout?: number;
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
    validateStatus?: ((status: number) => boolean) | null;
    maxRedirects?: number;
    responseType?: 'arraybuffer' | 'json' | 'text' | 'blob';
  }

  interface AxiosResponse<T = unknown> {
    data: T;
    status: number;
  }

  interface AxiosError {
    response?: {
      data?: { description?: string; error?: { message?: string } };
      status?: number;
    };
    message: string;
    code?: string;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function get<T = unknown>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function isAxiosError(err: unknown): err is AxiosError;

  const axios: {
    get: typeof get;
    post: typeof post;
    isAxiosError: typeof isAxiosError;
  };

  export default axios;
}
