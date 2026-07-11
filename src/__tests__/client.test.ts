import { describe, expect, test } from 'bun:test';
import {
  ANYTYPE_API_VERSION,
  AnywriteApiError,
  type ApiErrorKind,
  type FetchLike,
  type OffsetPage,
  paginateCursor,
  paginateOffset,
  request,
} from '../client.ts';

const BASE_URL = 'http://localhost:31009';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('request — headers', () => {
  test('sends Bearer + Anytype-Version, and JSON content-type for a body', async () => {
    let seenRequest: Request | undefined;
    const fetchImpl: FetchLike = async (input, init) => {
      seenRequest = new Request(input as string, init);
      return jsonResponse(200, { ok: true });
    };

    await request(
      { baseUrl: BASE_URL, apiKey: 'fixture-key', fetchImpl },
      { method: 'POST', path: '/v1/spaces', body: { name: 'x' } },
    );

    expect(seenRequest?.headers.get('Authorization')).toBe('Bearer fixture-key');
    expect(seenRequest?.headers.get('Anytype-Version')).toBe(ANYTYPE_API_VERSION);
    expect(seenRequest?.headers.get('Content-Type')).toBe('application/json');
  });

  test('omits Authorization when apiKey is null (auth challenge endpoints)', async () => {
    let seenRequest: Request | undefined;
    const fetchImpl: FetchLike = async (input, init) => {
      seenRequest = new Request(input as string, init);
      return jsonResponse(201, { challenge_id: 'c1' });
    };

    await request(
      { baseUrl: BASE_URL, apiKey: null, fetchImpl },
      { method: 'POST', path: '/v1/auth/challenges', body: { app_name: 'anywrite' } },
    );

    expect(seenRequest?.headers.has('Authorization')).toBe(false);
    expect(seenRequest?.headers.get('Anytype-Version')).toBe(ANYTYPE_API_VERSION);
  });

  test('encodes query params and skips undefined values', async () => {
    let seenUrl: string | undefined;
    const fetchImpl: FetchLike = async (input) => {
      seenUrl = input as string;
      return jsonResponse(200, { data: [] });
    };

    await request(
      { baseUrl: BASE_URL, apiKey: 'k', fetchImpl },
      { method: 'GET', path: '/v1/spaces', query: { offset: 10, limit: 100, before: undefined } },
    );

    const url = new URL(seenUrl as string);
    expect(url.searchParams.get('offset')).toBe('10');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.has('before')).toBe(false);
  });

  test('sets Anytype-Heartbeat-Seconds when provided', async () => {
    let seenRequest: Request | undefined;
    const fetchImpl: FetchLike = async (input, init) => {
      seenRequest = new Request(input as string, init);
      return new Response(null, { status: 200 });
    };

    await request(
      { baseUrl: BASE_URL, apiKey: 'k', fetchImpl },
      {
        method: 'GET',
        path: '/v1/spaces/s/chats/c/messages/stream',
        sse: true,
        heartbeatSeconds: 15,
      },
    );

    expect(seenRequest?.headers.get('Anytype-Heartbeat-Seconds')).toBe('15');
  });
});

describe('request — error mapping', () => {
  const cases: Array<{ status: number; kind: ApiErrorKind }> = [
    { status: 400, kind: 'bad_request' },
    { status: 401, kind: 'unauthorized' },
    { status: 403, kind: 'forbidden' },
    { status: 404, kind: 'not_found' },
    { status: 410, kind: 'gone' },
    { status: 429, kind: 'rate_limit' },
    { status: 500, kind: 'server_error' },
  ];

  for (const { status, kind } of cases) {
    test(`maps status ${status} to kind "${kind}"`, async () => {
      const envelope = {
        object: 'error',
        status,
        code: `code_${status}`,
        message: `msg ${status}`,
      };
      const fetchImpl: FetchLike = async () => jsonResponse(status, envelope);

      await expect(
        request(
          { baseUrl: BASE_URL, apiKey: 'k', fetchImpl },
          { method: 'GET', path: '/v1/spaces' },
        ),
      ).rejects.toThrow(AnywriteApiError);

      try {
        await request(
          { baseUrl: BASE_URL, apiKey: 'k', fetchImpl },
          { method: 'GET', path: '/v1/spaces' },
        );
        throw new Error('expected request to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(AnywriteApiError);
        const apiError = err as AnywriteApiError;
        expect(apiError.status).toBe(status);
        expect(apiError.kind).toBe(kind);
        expect(apiError.envelope).toEqual(envelope);
      }
    });
  }

  test('410 and 429 are distinguishable from each other and from 400', async () => {
    const goneFetch: FetchLike = async () =>
      jsonResponse(410, { object: 'error', status: 410, code: 'resource_gone', message: 'gone' });
    const rateLimitFetch: FetchLike = async () =>
      jsonResponse(429, {
        object: 'error',
        status: 429,
        code: 'rate_limited',
        message: 'slow down',
      });

    const [goneErr, rateLimitErr] = await Promise.all([
      request(
        { baseUrl: BASE_URL, apiKey: 'k', fetchImpl: goneFetch },
        { method: 'DELETE', path: '/x' },
      ).catch((e) => e as AnywriteApiError),
      request(
        { baseUrl: BASE_URL, apiKey: 'k', fetchImpl: rateLimitFetch },
        { method: 'DELETE', path: '/y' },
      ).catch((e) => e as AnywriteApiError),
    ]);

    expect(goneErr.kind).toBe('gone');
    expect(rateLimitErr.kind).toBe('rate_limit');
    expect(goneErr.kind).not.toBe(rateLimitErr.kind);
  });

  test('unmapped status falls back to kind "unknown"', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse(418, { object: 'error', status: 418 });

    try {
      await request(
        { baseUrl: BASE_URL, apiKey: 'k', fetchImpl },
        { method: 'GET', path: '/v1/spaces' },
      );
      throw new Error('expected request to reject');
    } catch (err) {
      expect((err as AnywriteApiError).kind).toBe('unknown');
    }
  });
});

describe('request — response shapes', () => {
  test('binary quirk returns ArrayBuffer + content-type', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl: FetchLike = async () =>
      new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/png' } });

    const result = await request(
      { baseUrl: BASE_URL, apiKey: 'k', fetchImpl },
      { method: 'GET', path: '/v1/spaces/s/files/f', binary: true },
    );

    if (result.kind !== 'binary') {
      throw new Error(`expected binary result, got ${result.kind}`);
    }
    expect(new Uint8Array(result.data)).toEqual(bytes);
    expect(result.contentType).toBe('image/png');
  });

  test('multipart spec sends the file under the given field name', async () => {
    let seenForm: FormData | undefined;
    const fetchImpl: FetchLike = async (_input, init) => {
      seenForm = init?.body as FormData;
      return jsonResponse(200, { object_id: 'f1' });
    };

    const file = new Blob(['hello'], { type: 'text/plain' });
    await request(
      { baseUrl: BASE_URL, apiKey: 'k', fetchImpl },
      {
        method: 'POST',
        path: '/v1/spaces/s/files',
        multipart: { fieldName: 'file', file, fileName: 'a.txt' },
      },
    );

    expect(seenForm?.get('file')).toBeInstanceOf(Blob);
  });

  test('sse quirk yields parsed data: events from the fetch body reader', async () => {
    const sseBody =
      'event: message_added\ndata: {"id":"1"}\n\n' + 'event: message_updated\ndata: {"id":"2"}\n\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseBody));
        controller.close();
      },
    });
    const fetchImpl: FetchLike = async () => new Response(stream, { status: 200 });

    const result = await request(
      { baseUrl: BASE_URL, apiKey: 'k', fetchImpl },
      { method: 'GET', path: '/v1/spaces/s/chats/c/messages/stream', sse: true },
    );

    if (result.kind !== 'stream') {
      throw new Error(`expected stream result, got ${result.kind}`);
    }
    const events = [];
    for await (const event of result.events) {
      events.push(event);
    }
    expect(events).toEqual([
      { event: 'message_added', data: { id: '1' } },
      { event: 'message_updated', data: { id: '2' } },
    ]);
  });
});

describe('paginateOffset', () => {
  test('concatenates data across pages and stops on has_more:false', async () => {
    const pages: Record<number, OffsetPage<number>> = {
      0: { data: [1, 2], pagination: { has_more: true, limit: 2, offset: 0, total: 3 } },
      2: { data: [3], pagination: { has_more: false, limit: 2, offset: 2, total: 3 } },
    };
    const seenOffsets: number[] = [];

    const results = await paginateOffset(async (offset) => {
      seenOffsets.push(offset);
      const page = pages[offset];
      if (!page) {
        throw new Error(`unexpected offset ${offset}`);
      }
      return page;
    }, 2);

    expect(results).toEqual([1, 2, 3]);
    expect(seenOffsets).toEqual([0, 2]);
  });

  test('stops immediately on an empty first page', async () => {
    const results = await paginateOffset(async () => ({
      data: [],
      pagination: { has_more: true },
    }));
    expect(results).toEqual([]);
  });
});

describe('paginateCursor', () => {
  test('walks after_order_id from the last item of each page', async () => {
    type Msg = { id: string; order_id: string };
    const pages: Record<string, Msg[]> = {
      root: [
        { id: 'a', order_id: 'o1' },
        { id: 'b', order_id: 'o2' },
      ],
      o2: [{ id: 'c', order_id: 'o3' }],
    };
    const seenCursors: (string | undefined)[] = [];

    const results = await paginateCursor<Msg>(
      async (afterOrderId) => {
        seenCursors.push(afterOrderId);
        return pages[afterOrderId ?? 'root'] ?? [];
      },
      (item) => item.order_id,
      2,
    );

    expect(results.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(seenCursors).toEqual([undefined, 'o2']);
  });

  test('stops on an empty page', async () => {
    const results = await paginateCursor<{ order_id: string }>(
      async () => [],
      (item) => item.order_id,
      50,
    );
    expect(results).toEqual([]);
  });
});
