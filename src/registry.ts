/**
 * The endpoint registry — every one of the 52 Anytype local API operations (spec version
 * 2025-11-08) encoded as pure data: method, path template, params, and per-endpoint quirks.
 * No fetch logic and no per-endpoint functions live here; src/client.ts executes any
 * EndpointSpec against the live API, and src/cli.ts dispatches resource/action pairs into it.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type ParamType = 'string' | 'number' | 'boolean' | 'string[]';

export interface ParamSpec {
  name: string;
  type: ParamType;
  required?: boolean;
}

/** Behavior that diverges from the plain JSON-in/JSON-out request/response shape. */
export type Quirk = 'multipart' | 'binary' | 'sse' | 'wrappedArray';

export type Pagination = 'offset' | 'cursor' | 'none';

export interface EndpointSpec {
  method: HttpMethod;
  /** e.g. '/v1/spaces/{space_id}/objects/{object_id}' */
  path: string;
  /** In path order, matching the '{...}' placeholders in `path`. */
  pathParams: string[];
  queryParams?: ParamSpec[];
  /** Flat named body fields. Nested/oneOf shapes (filters, properties[], icon) are not
   * modeled here — they go through the CLI's raw --json escape hatch. */
  bodyParams?: ParamSpec[];
  /** Required body fields, by name (subset of bodyParams). */
  required?: string[];
  /** Only set on objects.create ('body') and objects.update ('markdown') — the API's
   * create-vs-update field-name asymmetry for the object's markdown content. */
  bodyField?: 'body' | 'markdown';
  quirks?: Quirk[];
  pagination: Pagination;
  /** Only set on lists.objects — an empty view_id path segment is accepted by the API and
   * returns all objects in the list, despite the spec marking the param required. */
  viewIdOptional?: boolean;
  /** Only set (to false) on the two auth endpoints — no Bearer token exists yet. */
  auth?: false;
}

const offsetLimit: ParamSpec[] = [
  { name: 'offset', type: 'number' },
  { name: 'limit', type: 'number' },
];

export const ENDPOINTS: Record<string, Record<string, EndpointSpec>> = {
  auth: {
    challenge: {
      method: 'POST',
      path: '/v1/auth/challenges',
      pathParams: [],
      bodyParams: [{ name: 'app_name', type: 'string' }],
      pagination: 'none',
      auth: false,
    },
    createKey: {
      method: 'POST',
      path: '/v1/auth/api_keys',
      pathParams: [],
      bodyParams: [
        { name: 'challenge_id', type: 'string' },
        { name: 'code', type: 'string' },
      ],
      pagination: 'none',
      auth: false,
    },
  },

  search: {
    global: {
      method: 'POST',
      path: '/v1/search',
      pathParams: [],
      queryParams: offsetLimit,
      bodyParams: [
        { name: 'query', type: 'string' },
        { name: 'types', type: 'string[]' },
      ],
      pagination: 'offset',
    },
    space: {
      method: 'POST',
      path: '/v1/spaces/{space_id}/search',
      pathParams: ['space_id'],
      queryParams: offsetLimit,
      bodyParams: [
        { name: 'query', type: 'string' },
        { name: 'types', type: 'string[]' },
      ],
      pagination: 'offset',
    },
  },

  spaces: {
    list: {
      method: 'GET',
      path: '/v1/spaces',
      pathParams: [],
      queryParams: offsetLimit,
      pagination: 'offset',
    },
    create: {
      method: 'POST',
      path: '/v1/spaces',
      pathParams: [],
      bodyParams: [
        { name: 'name', type: 'string', required: true },
        { name: 'description', type: 'string' },
      ],
      required: ['name'],
      pagination: 'none',
    },
    get: {
      method: 'GET',
      path: '/v1/spaces/{space_id}',
      pathParams: ['space_id'],
      pagination: 'none',
    },
    update: {
      method: 'PATCH',
      path: '/v1/spaces/{space_id}',
      pathParams: ['space_id'],
      bodyParams: [
        { name: 'name', type: 'string' },
        { name: 'description', type: 'string' },
      ],
      pagination: 'none',
    },
  },

  chat: {
    list: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/chats',
      pathParams: ['space_id'],
      queryParams: offsetLimit,
      pagination: 'offset',
    },
    create: {
      method: 'POST',
      path: '/v1/spaces/{space_id}/chats',
      pathParams: ['space_id'],
      bodyParams: [{ name: 'name', type: 'string' }],
      pagination: 'none',
    },
    messages: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/chats/{chat_id}/messages',
      pathParams: ['space_id', 'chat_id'],
      queryParams: [
        { name: 'before_order_id', type: 'string' },
        { name: 'after_order_id', type: 'string' },
        { name: 'limit', type: 'number' },
      ],
      pagination: 'cursor',
    },
    send: {
      method: 'POST',
      path: '/v1/spaces/{space_id}/chats/{chat_id}/messages',
      pathParams: ['space_id', 'chat_id'],
      bodyParams: [
        { name: 'text', type: 'string', required: true },
        { name: 'style', type: 'string' },
        { name: 'reply_to_message_id', type: 'string' },
      ],
      required: ['text'],
      pagination: 'none',
    },
    'delete-message': {
      method: 'DELETE',
      path: '/v1/spaces/{space_id}/chats/{chat_id}/messages/{message_id}',
      pathParams: ['space_id', 'chat_id', 'message_id'],
      pagination: 'none',
    },
    'get-message': {
      method: 'GET',
      path: '/v1/spaces/{space_id}/chats/{chat_id}/messages/{message_id}',
      pathParams: ['space_id', 'chat_id', 'message_id'],
      pagination: 'none',
    },
    edit: {
      method: 'PATCH',
      path: '/v1/spaces/{space_id}/chats/{chat_id}/messages/{message_id}',
      pathParams: ['space_id', 'chat_id', 'message_id'],
      bodyParams: [
        { name: 'text', type: 'string', required: true },
        { name: 'style', type: 'string' },
      ],
      required: ['text'],
      pagination: 'none',
    },
    'toggle-reaction': {
      method: 'POST',
      path: '/v1/spaces/{space_id}/chats/{chat_id}/messages/{message_id}/reactions',
      pathParams: ['space_id', 'chat_id', 'message_id'],
      bodyParams: [{ name: 'emoji', type: 'string', required: true }],
      required: ['emoji'],
      pagination: 'none',
    },
    read: {
      method: 'POST',
      path: '/v1/spaces/{space_id}/chats/{chat_id}/messages/read',
      pathParams: ['space_id', 'chat_id'],
      bodyParams: [
        { name: 'before_order_id', type: 'string' },
        { name: 'after_order_id', type: 'string' },
        { name: 'last_state_id', type: 'string' },
        { name: 'type', type: 'string' },
      ],
      pagination: 'none',
    },
    search: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/chats/{chat_id}/messages/search',
      pathParams: ['space_id', 'chat_id'],
      queryParams: [
        { name: 'query', type: 'string', required: true },
        { name: 'offset', type: 'number' },
        { name: 'limit', type: 'number' },
      ],
      pagination: 'offset',
    },
    stream: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/chats/{chat_id}/messages/stream',
      pathParams: ['space_id', 'chat_id'],
      queryParams: [{ name: 'limit', type: 'number' }],
      quirks: ['sse'],
      pagination: 'none',
    },
    'reactions-read': {
      method: 'POST',
      path: '/v1/spaces/{space_id}/chats/{chat_id}/reactions/read',
      pathParams: ['space_id', 'chat_id'],
      bodyParams: [{ name: 'order_id', type: 'string' }],
      pagination: 'none',
    },
    'read-all': {
      method: 'POST',
      path: '/v1/spaces/{space_id}/chats/{chat_id}/read_all',
      pathParams: ['space_id', 'chat_id'],
      pagination: 'none',
    },
  },

  files: {
    upload: {
      method: 'POST',
      path: '/v1/spaces/{space_id}/files',
      pathParams: ['space_id'],
      quirks: ['multipart'],
      pagination: 'none',
    },
    download: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/files/{file_id}',
      pathParams: ['space_id', 'file_id'],
      quirks: ['binary'],
      pagination: 'none',
    },
    delete: {
      method: 'DELETE',
      path: '/v1/spaces/{space_id}/files/{file_id}',
      pathParams: ['space_id', 'file_id'],
      pagination: 'none',
    },
  },

  lists: {
    views: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/lists/{list_id}/views',
      pathParams: ['space_id', 'list_id'],
      queryParams: offsetLimit,
      pagination: 'offset',
    },
    objects: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/lists/{list_id}/views/{view_id}/objects',
      pathParams: ['space_id', 'list_id', 'view_id'],
      queryParams: offsetLimit,
      pagination: 'offset',
      viewIdOptional: true,
    },
    add: {
      method: 'POST',
      path: '/v1/spaces/{space_id}/lists/{list_id}/objects',
      pathParams: ['space_id', 'list_id'],
      bodyParams: [{ name: 'objects', type: 'string[]' }],
      quirks: ['wrappedArray'],
      pagination: 'none',
    },
    remove: {
      method: 'DELETE',
      path: '/v1/spaces/{space_id}/lists/{list_id}/objects/{object_id}',
      pathParams: ['space_id', 'list_id', 'object_id'],
      pagination: 'none',
    },
  },

  members: {
    list: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/members',
      pathParams: ['space_id'],
      queryParams: offsetLimit,
      pagination: 'offset',
    },
    get: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/members/{member_id}',
      pathParams: ['space_id', 'member_id'],
      pagination: 'none',
    },
  },

  objects: {
    list: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/objects',
      pathParams: ['space_id'],
      queryParams: offsetLimit,
      pagination: 'offset',
    },
    create: {
      method: 'POST',
      path: '/v1/spaces/{space_id}/objects',
      pathParams: ['space_id'],
      bodyParams: [
        { name: 'type_key', type: 'string', required: true },
        { name: 'name', type: 'string' },
        { name: 'body', type: 'string' },
        { name: 'template_id', type: 'string' },
      ],
      required: ['type_key'],
      bodyField: 'body',
      pagination: 'none',
    },
    get: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/objects/{object_id}',
      pathParams: ['space_id', 'object_id'],
      queryParams: [{ name: 'format', type: 'string' }],
      pagination: 'none',
    },
    update: {
      method: 'PATCH',
      path: '/v1/spaces/{space_id}/objects/{object_id}',
      pathParams: ['space_id', 'object_id'],
      bodyParams: [
        { name: 'name', type: 'string' },
        { name: 'markdown', type: 'string' },
        { name: 'type_key', type: 'string' },
      ],
      bodyField: 'markdown',
      pagination: 'none',
    },
    delete: {
      method: 'DELETE',
      path: '/v1/spaces/{space_id}/objects/{object_id}',
      pathParams: ['space_id', 'object_id'],
      pagination: 'none',
    },
  },

  properties: {
    list: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/properties',
      pathParams: ['space_id'],
      queryParams: offsetLimit,
      pagination: 'offset',
    },
    create: {
      method: 'POST',
      path: '/v1/spaces/{space_id}/properties',
      pathParams: ['space_id'],
      bodyParams: [
        { name: 'format', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'key', type: 'string' },
      ],
      required: ['format', 'name'],
      pagination: 'none',
    },
    get: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/properties/{property_id}',
      pathParams: ['space_id', 'property_id'],
      pagination: 'none',
    },
    update: {
      method: 'PATCH',
      path: '/v1/spaces/{space_id}/properties/{property_id}',
      pathParams: ['space_id', 'property_id'],
      bodyParams: [
        { name: 'name', type: 'string', required: true },
        { name: 'key', type: 'string' },
      ],
      required: ['name'],
      pagination: 'none',
    },
    delete: {
      method: 'DELETE',
      path: '/v1/spaces/{space_id}/properties/{property_id}',
      pathParams: ['space_id', 'property_id'],
      pagination: 'none',
    },
  },

  tags: {
    list: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/properties/{property_id}/tags',
      pathParams: ['space_id', 'property_id'],
      queryParams: offsetLimit,
      pagination: 'offset',
    },
    create: {
      method: 'POST',
      path: '/v1/spaces/{space_id}/properties/{property_id}/tags',
      pathParams: ['space_id', 'property_id'],
      bodyParams: [
        { name: 'color', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'key', type: 'string' },
      ],
      required: ['color', 'name'],
      pagination: 'none',
    },
    get: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/properties/{property_id}/tags/{tag_id}',
      pathParams: ['space_id', 'property_id', 'tag_id'],
      pagination: 'none',
    },
    update: {
      method: 'PATCH',
      path: '/v1/spaces/{space_id}/properties/{property_id}/tags/{tag_id}',
      pathParams: ['space_id', 'property_id', 'tag_id'],
      bodyParams: [
        { name: 'name', type: 'string' },
        { name: 'color', type: 'string' },
        { name: 'key', type: 'string' },
      ],
      pagination: 'none',
    },
    delete: {
      method: 'DELETE',
      path: '/v1/spaces/{space_id}/properties/{property_id}/tags/{tag_id}',
      pathParams: ['space_id', 'property_id', 'tag_id'],
      pagination: 'none',
    },
  },

  templates: {
    list: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/types/{type_id}/templates',
      pathParams: ['space_id', 'type_id'],
      queryParams: offsetLimit,
      pagination: 'offset',
    },
    get: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/types/{type_id}/templates/{template_id}',
      pathParams: ['space_id', 'type_id', 'template_id'],
      pagination: 'none',
    },
  },

  types: {
    list: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/types',
      pathParams: ['space_id'],
      queryParams: offsetLimit,
      pagination: 'offset',
    },
    create: {
      method: 'POST',
      path: '/v1/spaces/{space_id}/types',
      pathParams: ['space_id'],
      bodyParams: [
        { name: 'layout', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'plural_name', type: 'string', required: true },
        { name: 'key', type: 'string' },
      ],
      required: ['layout', 'name', 'plural_name'],
      pagination: 'none',
    },
    get: {
      method: 'GET',
      path: '/v1/spaces/{space_id}/types/{type_id}',
      pathParams: ['space_id', 'type_id'],
      pagination: 'none',
    },
    update: {
      method: 'PATCH',
      path: '/v1/spaces/{space_id}/types/{type_id}',
      pathParams: ['space_id', 'type_id'],
      bodyParams: [
        { name: 'name', type: 'string' },
        { name: 'plural_name', type: 'string' },
        { name: 'layout', type: 'string' },
        { name: 'key', type: 'string' },
      ],
      pagination: 'none',
    },
    delete: {
      method: 'DELETE',
      path: '/v1/spaces/{space_id}/types/{type_id}',
      pathParams: ['space_id', 'type_id'],
      pagination: 'none',
    },
  },
};
