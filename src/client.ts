/**
 * One HTTP wrapper for every Anytype endpoint. Callers pass an endpoint shape as data
 * (method, path, query, body, quirk flags) — this module never knows a concrete path.
 */

export const ANYTYPE_API_VERSION = '2025-11-08';

/** Matches the shape of the global `fetch`, minus Bun's `preconnect` namespace member — this is
 * what unit tests inject to avoid hitting the network. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface MultipartSpec {
  fieldName: string;
  file: Blob;
  fileName?: string;
}

export interface RequestSpec {
  method: HttpMethod;
  /** Path already interpolated with any path params, e.g. "/v1/spaces/<id>/objects". */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  multipart?: MultipartSpec;
  /** Response is raw bytes, not JSON. */
  binary?: boolean;
  /** Response is a server-sent-events stream. */
  sse?: boolean;
  /** Sets Anytype-Heartbeat-Seconds (1-60), SSE endpoints only. */
  heartbeatSeconds?: number;
}

export interface ClientConfig {
  baseUrl: string;
  /** null for the two unauthenticated auth endpoints. */
  apiKey: string | null;
  fetchImpl?: FetchLike;
}

export interface SseEvent {
  event?: string;
  data: unknown;
}

export type RequestResult =
  | { kind: 'json'; data: unknown }
  | { kind: 'binary'; data: ArrayBuffer; contentType: string | null }
  | { kind: 'stream'; events: AsyncGenerator<SseEvent, void, unknown> };

/** The wire error envelope, verbatim — {"object":"error","status":N,"code":"...","message":"..."}. */
export interface ErrorEnvelope {
  object?: string;
  status?: number;
  code?: string;
  message?: string;
}

export type ApiErrorKind =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'gone'
  | 'rate_limit'
  | 'server_error'
  | 'unknown';

const STATUS_TO_KIND: Record<number, ApiErrorKind> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  410: 'gone',
  429: 'rate_limit',
  500: 'server_error',
};

export class AnywriteApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  readonly envelope: ErrorEnvelope;

  constructor(status: number, envelope: ErrorEnvelope) {
    super(envelope.message ?? `Request failed with status ${status}`);
    this.name = 'AnywriteApiError';
    this.status = status;
    this.kind = STATUS_TO_KIND[status] ?? 'unknown';
    this.envelope = envelope;
  }
}

async function buildApiError(response: Response): Promise<AnywriteApiError> {
  const text = await response.text();
  let envelope: ErrorEnvelope = {};
  if (text) {
    try {
      envelope = JSON.parse(text) as ErrorEnvelope;
    } catch {
      envelope = { message: text };
    }
  }
  return new AnywriteApiError(response.status, { status: response.status, ...envelope });
}

function buildUrl(baseUrl: string, spec: RequestSpec): string {
  const url = new URL(spec.path, baseUrl);
  if (spec.query) {
    for (const [key, value] of Object.entries(spec.query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function buildHeaders(config: ClientConfig, spec: RequestSpec): Headers {
  const headers = new Headers();
  headers.set('Anytype-Version', ANYTYPE_API_VERSION);
  if (config.apiKey) {
    headers.set('Authorization', `Bearer ${config.apiKey}`);
  }
  if (spec.heartbeatSeconds !== undefined) {
    headers.set('Anytype-Heartbeat-Seconds', String(spec.heartbeatSeconds));
  }
  return headers;
}

function buildBody(headers: Headers, spec: RequestSpec): Bun.BodyInit | undefined {
  if (spec.multipart) {
    const form = new FormData();
    form.set(spec.multipart.fieldName, spec.multipart.file, spec.multipart.fileName);
    return form;
  }
  if (spec.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    return JSON.stringify(spec.body);
  }
  return undefined;
}

async function* readSseEvents(response: Response): AsyncGenerator<SseEvent, void, unknown> {
  const body = response.body;
  if (!body) {
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseEventBlock(block);
        if (parsed) {
          yield parsed;
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseEventBlock(block: string): SseEvent | null {
  let eventName: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  const raw = dataLines.join('\n');
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // Not every SSE payload is JSON — keep the raw string.
  }
  return { event: eventName, data };
}

/** Executes one endpoint spec against the live API. The only function that calls fetch. */
export async function request(config: ClientConfig, spec: RequestSpec): Promise<RequestResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const headers = buildHeaders(config, spec);
  const body = buildBody(headers, spec);
  const response = await fetchImpl(buildUrl(config.baseUrl, spec), {
    method: spec.method,
    headers,
    body,
  });

  if (!response.ok) {
    throw await buildApiError(response);
  }

  if (spec.sse) {
    return { kind: 'stream', events: readSseEvents(response) };
  }

  if (spec.binary) {
    return {
      kind: 'binary',
      data: await response.arrayBuffer(),
      contentType: response.headers.get('content-type'),
    };
  }

  const text = await response.text();
  return { kind: 'json', data: text ? JSON.parse(text) : null };
}

export interface OffsetPagination {
  has_more?: boolean;
  limit?: number;
  offset?: number;
  total?: number;
}

export interface OffsetPage<T> {
  data?: T[];
  pagination?: OffsetPagination;
}

/** Walks offset/limit pages until pagination.has_more is false, concatenating data. */
export async function paginateOffset<T>(
  fetchPage: (offset: number) => Promise<OffsetPage<T>>,
  limit = 100,
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  while (true) {
    const page = await fetchPage(offset);
    const items = page.data ?? [];
    results.push(...items);
    if (!page.pagination?.has_more || items.length === 0) {
      break;
    }
    offset += items.length || limit;
  }
  return results;
}

/**
 * Walks cursor pages (chat messages) via after_order_id, taken from the last item of the
 * previous page. Stops once a page returns fewer items than limit, or an empty page.
 */
export async function paginateCursor<T>(
  fetchPage: (afterOrderId: string | undefined) => Promise<T[]>,
  getOrderId: (item: T) => string,
  limit = 50,
): Promise<T[]> {
  const results: T[] = [];
  let afterOrderId: string | undefined;
  while (true) {
    const page = await fetchPage(afterOrderId);
    results.push(...page);
    if (page.length === 0 || page.length < limit) {
      break;
    }
    const lastItem = page[page.length - 1] as T;
    afterOrderId = getOrderId(lastItem);
  }
  return results;
}
