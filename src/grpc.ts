/**
 * Talks to Anytype's internal middleware gRPC service (anytype-heart's `ClientCommands`),
 * NOT the public Local JSON API that the rest of this CLI uses. The public REST API has no
 * way to embed an image as a real inline block in an object's body — only this internal
 * protocol does (it's what the desktop app itself calls for drag-and-drop image embedding).
 *
 * A session authenticated with the normal REST app key is scoped to "JsonAPI" and gets
 * PermissionDenied on every block-level RPC. A session authenticated at "Limited" scope
 * (the same scope Anytype's own WebClipper extension uses) is allowed a specific whitelist
 * that includes BlockPaste — that's the mechanism this module uses. See grpcAuth() for how
 * that scope is obtained (same 4-digit-code consent flow as the REST `auth` command, just
 * requesting a different permission level).
 *
 * Proto schema is compiled ahead of time into protos/anytype-heart.desc (a binary
 * FileDescriptorSet, via `protoc --include_imports --descriptor_set_out`) and embedded into
 * the compiled binary at build time — @grpc/proto-loader reading .proto files directly off
 * disk does NOT survive `bun build --compile` (the files aren't bundled), but reading an
 * embedded descriptor buffer does.
 */

import { readFileSync } from 'node:fs';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
// @ts-expect-error - embedded binary asset, no type declarations
import descriptorAsset from '../protos/anytype-heart.desc' with { type: 'file' };

export const DEFAULT_GRPC_ADDRESS = '127.0.0.1:65406';

interface ClientCommandsClient extends grpc.Client {
  AccountLocalLinkNewChallenge(
    request: { appName: string; scope: string },
    callback: (err: grpc.ServiceError | null, response: { challengeId: string }) => void,
  ): void;
  AccountLocalLinkSolveChallenge(
    request: { challengeId: string; answer: string },
    callback: (
      err: grpc.ServiceError | null,
      response: { sessionToken: string; appKey: string },
    ) => void,
  ): void;
  WalletCreateSession(
    request: { appKey: string },
    callback: (
      err: grpc.ServiceError | null,
      response: { token: string; accountId: string },
    ) => void,
  ): void;
  BlockPaste(
    request: { contextId: string; fileSlot: Array<{ name: string; localPath: string }> },
    metadata: grpc.Metadata,
    callback: (err: grpc.ServiceError | null, response: { blockIds: string[] }) => void,
  ): void;
  ObjectShow(
    request: { objectId: string },
    metadata: grpc.Metadata,
    callback: (err: grpc.ServiceError | null, response: ObjectShowResponse) => void,
  ): void;
}

// ObjectShow's real response is a large dynamic protobuf-derived shape (the full object view,
// every block type, every relation) — this only models the one path this module reads: a
// file block's upload state.
interface ObjectShowResponse {
  objectView?: {
    blocks?: Array<{
      id: string;
      file?: { state: string; error?: string };
    }>;
  };
}

let cachedClient: ClientCommandsClient | null = null;

function client(address: string = DEFAULT_GRPC_ADDRESS): ClientCommandsClient {
  if (cachedClient) {
    return cachedClient;
  }
  const descriptorBuffer = readFileSync(descriptorAsset as string);
  const packageDefinition = protoLoader.loadFileDescriptorSetFromBuffer(descriptorBuffer, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDefinition);
  const anytypeNamespace = proto.anytype as grpc.GrpcObject;
  const ClientCommandsCtor = anytypeNamespace.ClientCommands as grpc.ServiceClientConstructor;
  cachedClient = new ClientCommandsCtor(
    address,
    grpc.credentials.createInsecure(),
  ) as unknown as ClientCommandsClient;
  return cachedClient;
}

// Every anytype.ClientCommands RPC response carries its OWN error envelope (an `error` field
// with a `code`/`description`, mirroring the REST API's error shape) separate from a gRPC
// transport-level error — a bad challenge code, an unknown object id, etc. come back as a
// perfectly successful gRPC call whose payload says the domain operation failed. Checking only
// the callback's `err` parameter misses all of these: solving a challenge with a garbage code
// silently "succeeds" with an empty appKey unless this envelope is checked too.
interface DomainErrorEnvelope {
  error?: { code?: string | number; description?: string };
}

// Response types are hand-written per-RPC (only the fields this module reads), so they don't
// structurally declare the `error` envelope every real response also carries — checked here via
// a widening cast rather than a generic constraint, since the constraint form makes TS demand
// every response interface redundantly redeclare `error?`.
function checkDomainError(response: unknown): void {
  const envelope = response as DomainErrorEnvelope;
  const code = envelope.error?.code;
  if (code !== undefined && code !== 0 && code !== 'NULL') {
    throw new Error(envelope.error?.description || `request failed with code ${code}`);
  }
}

function call<TRequest, TResponse>(
  method: (
    request: TRequest,
    callback: (err: grpc.ServiceError | null, response: TResponse) => void,
  ) => void,
  request: TRequest,
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    method(request, (err, response) => {
      if (err) {
        reject(new Error(err.message));
        return;
      }
      try {
        checkDomainError(response);
      } catch (domainErr) {
        reject(domainErr);
        return;
      }
      resolve(response);
    });
  });
}

function callWithToken<TRequest, TResponse>(
  method: (
    request: TRequest,
    metadata: grpc.Metadata,
    callback: (err: grpc.ServiceError | null, response: TResponse) => void,
  ) => void,
  request: TRequest,
  token: string,
): Promise<TResponse> {
  const metadata = new grpc.Metadata();
  metadata.set('token', token);
  return new Promise((resolve, reject) => {
    method(request, metadata, (err, response) => {
      if (err) {
        reject(new Error(err.message));
        return;
      }
      try {
        checkDomainError(response);
      } catch (domainErr) {
        reject(domainErr);
        return;
      }
      resolve(response);
    });
  });
}

/** Starts a "Limited" scope local-link challenge — a 4-digit code pops up in the Anytype
 * desktop app, same UX as the REST `auth` challenge but requesting the scope that permits
 * BlockPaste instead of the REST-only "JsonAPI" scope. The code expires quickly (observed:
 * well under a minute) — solve it promptly. */
export async function newLimitedChallenge(appName: string): Promise<string> {
  const c = client();
  const response = await call(c.AccountLocalLinkNewChallenge.bind(c), {
    appName,
    scope: 'Limited',
  });
  return response.challengeId;
}

/** Exchanges a challenge id + the 4-digit code for a persistent "Limited"-scope app key. */
export async function solveLimitedChallenge(
  challengeId: string,
  code: string,
): Promise<{ appKey: string; sessionToken: string }> {
  const c = client();
  const response = await call(c.AccountLocalLinkSolveChallenge.bind(c), {
    challengeId,
    answer: code,
  });
  return { appKey: response.appKey, sessionToken: response.sessionToken };
}

/** Exchanges a persistent Limited-scope app key for a fresh session token. */
export async function createGrpcSession(appKey: string): Promise<string> {
  const c = client();
  const response = await call(c.WalletCreateSession.bind(c), { appKey });
  return response.token;
}

/** Pastes a local file as a new block at the end of an object's body — this is the same RPC
 * the desktop app calls internally for drag-and-drop image embedding. Returns the new block's
 * id so its upload state can be polled (see waitForBlockDone). */
export async function pasteImageBlock(
  token: string,
  contextId: string,
  fileName: string,
  localPath: string,
): Promise<string> {
  const c = client();
  const response = await callWithToken(
    c.BlockPaste.bind(c),
    { contextId, fileSlot: [{ name: fileName, localPath }] },
    token,
  );
  const blockId = response.blockIds[0];
  if (!blockId) {
    throw new Error('BlockPaste returned no block id');
  }
  return blockId;
}

interface FileBlockState {
  state: string;
  error?: string;
}

/** Fetches the object's current block tree and reads back the upload state of one block.
 * Returns null if the block isn't found (e.g. already resolved into something else). */
async function getFileBlockState(
  token: string,
  objectId: string,
  blockId: string,
): Promise<FileBlockState | null> {
  const c = client();
  const response = await callWithToken(c.ObjectShow.bind(c), { objectId }, token);
  const blocks = response.objectView?.blocks;
  if (!Array.isArray(blocks)) {
    return null;
  }
  const block = blocks.find((b) => b.id === blockId);
  if (!block?.file) {
    return null;
  }
  return { state: block.file.state, error: block.file.error };
}

/** Polls a pasted block until its file upload reaches "Done" (or "Error"/timeout). The paste
 * call itself returns immediately with state "Uploading" — the actual file ingestion happens
 * asynchronously, and if the source file disappears before that finishes (observed: a rotated-
 * out temp file) the block gets stuck in "Uploading" forever with no error, showing as an
 * empty "Untitled" block in the app. Surfacing that here as a clear timeout, rather than
 * silently returning "success" the moment BlockPaste's initial response comes back, is the
 * whole point of this function. */
export async function waitForBlockDone(
  token: string,
  objectId: string,
  blockId: string,
  timeoutMs = 15_000,
  pollIntervalMs = 500,
): Promise<FileBlockState> {
  const deadline = Date.now() + timeoutMs;
  let last: FileBlockState | null = null;
  while (Date.now() < deadline) {
    last = await getFileBlockState(token, objectId, blockId);
    if (last && (last.state === 'Done' || last.state === 'Error')) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for block ${blockId} to finish uploading ` +
      `(last known state: ${last?.state ?? 'unknown'}) — the source file may have been ` +
      'deleted/moved before the upload could read it; verify the file still exists at the ' +
      'given path and try again',
  );
}
