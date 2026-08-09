import { createHash, createHmac } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export class ArtifactNotFoundError extends Error {}
export class ArtifactRangeError extends Error {
  constructor(readonly size: number) {
    super("Artifact range is not satisfiable.");
  }
}
export class ArtifactStorageError extends Error {}

export interface ArtifactByteRange {
  readonly start: number;
  readonly end: number;
  readonly length: number;
}

export interface ValidatedArtifactKey {
  readonly key: string;
  readonly fileName: string;
}

export interface LocalArtifactRead {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly range: ArtifactByteRange | undefined;
}

export interface S3ReadConfig {
  readonly endpoint: string | undefined;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}

const storageReviewIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const artifactFileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,511}$/;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/;
const sha256Pattern = /^[0-9a-f]{64}$/i;
const awsRegionPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
const dnsBucketPattern = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const emptyPayloadSha256 = createHash("sha256").update("").digest("hex");

export function validateArtifactStorageKey(
  storageKey: string,
  reviewId: string,
): ValidatedArtifactKey {
  const segments = storageKey.split("/");
  const storedReviewId = segments[0];
  const fileName = segments[1];
  if (
    segments.length !== 2 ||
    !storedReviewId ||
    !fileName ||
    !storageReviewIdPattern.test(storedReviewId) ||
    storedReviewId.toLocaleLowerCase("en-US") !== reviewId.toLocaleLowerCase("en-US") ||
    !artifactFileNamePattern.test(fileName) ||
    fileName === "." ||
    fileName === ".."
  ) {
    throw new ArtifactNotFoundError("Artifact storage identity is invalid.");
  }
  return { key: `${storedReviewId}/${fileName}`, fileName };
}

export function parseArtifactRange(
  rangeHeader: string | null,
  size: number,
): ArtifactByteRange | undefined {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new ArtifactStorageError("Artifact size metadata is invalid.");
  }
  if (!rangeHeader) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match || size === 0) throw new ArtifactRangeError(size);
  const rawStart = match[1] ?? "";
  const rawEnd = match[2] ?? "";
  if (!rawStart && !rawEnd) throw new ArtifactRangeError(size);

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new ArtifactRangeError(size);
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) {
      throw new ArtifactRangeError(size);
    }
    if (!rawEnd) {
      end = size - 1;
    } else {
      const requestedEnd = Number(rawEnd);
      if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
        throw new ArtifactRangeError(size);
      }
      end = Math.min(requestedEnd, size - 1);
    }
  }
  return { start, end, length: end - start + 1 };
}

export async function readVerifiedArtifactBytes(
  body: ReadableStream<Uint8Array>,
  expectedSize: number,
  expectedSha256: string,
  maximumBytes: number,
): Promise<Buffer> {
  if (expectedSize > maximumBytes) {
    throw new ArtifactStorageError("Artifact exceeds the public proof size limit.");
  }
  const chunks: Buffer[] = [];
  const reader = body.getReader();
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > expectedSize || size > maximumBytes) {
        throw new ArtifactStorageError("Artifact bytes exceed their durable size.");
      }
      chunks.push(Buffer.from(result.value));
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== expectedSize || sha256 !== expectedSha256.toLowerCase()) {
    throw new ArtifactStorageError("Artifact bytes do not match their durable proof.");
  }
  return bytes;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot !== "" &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

async function closeQuietly(file: FileHandle): Promise<void> {
  try {
    await file.close();
  } catch {
    // A cancelled or completed response may have already closed the handle.
  }
}

function fileBody(
  file: FileHandle,
  size: number,
  range: ArtifactByteRange | undefined,
): ReadableStream<Uint8Array> {
  let position = range?.start ?? 0;
  let remaining = range?.length ?? size;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await closeQuietly(file);
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (remaining === 0) {
        await close();
        controller.close();
        return;
      }
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1_024, remaining));
      try {
        const { bytesRead } = await file.read(chunk, 0, chunk.byteLength, position);
        if (bytesRead === 0) {
          await close();
          controller.close();
          return;
        }
        position += bytesRead;
        remaining -= bytesRead;
        controller.enqueue(Uint8Array.from(chunk.subarray(0, bytesRead)));
      } catch (error) {
        await close();
        controller.error(error);
      }
    },
    async cancel() {
      await close();
    },
  });
}

export async function openLocalArtifact(input: {
  readonly artifactRoot: string;
  readonly workspaceRoot: string;
  readonly storageKey: ValidatedArtifactKey;
  readonly expectedSize: number;
  readonly rangeHeader: string | null;
}): Promise<LocalArtifactRead> {
  const configuredRoot = isAbsolute(input.artifactRoot)
    ? resolve(input.artifactRoot)
    : resolve(input.workspaceRoot, input.artifactRoot);
  let canonicalRoot: string;
  let canonicalFile: string;
  try {
    canonicalRoot = await realpath(configuredRoot);
    canonicalFile = await realpath(resolve(configuredRoot, input.storageKey.key));
  } catch {
    throw new ArtifactNotFoundError("Artifact file is unavailable.");
  }
  if (!isWithinRoot(canonicalRoot, canonicalFile)) {
    throw new ArtifactNotFoundError("Artifact file is outside its storage root.");
  }

  let file: FileHandle;
  try {
    file = await open(canonicalFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new ArtifactNotFoundError("Artifact file is unavailable.");
  }
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || !Number.isSafeInteger(metadata.size)) {
      throw new ArtifactNotFoundError("Artifact file is unavailable.");
    }
    if (metadata.size !== input.expectedSize) {
      throw new ArtifactStorageError("Artifact file size does not match its durable metadata.");
    }
    const range = parseArtifactRange(input.rangeHeader, metadata.size);
    return { body: fileBody(file, metadata.size, range), size: metadata.size, range };
  } catch (error) {
    await closeQuietly(file);
    throw error;
  }
}

function validateS3Config(config: S3ReadConfig): void {
  if (!awsRegionPattern.test(config.region)) {
    throw new ArtifactStorageError("S3 region is invalid.");
  }
  if (
    !config.accessKeyId ||
    !config.secretAccessKey ||
    controlCharacterPattern.test(config.accessKeyId) ||
    controlCharacterPattern.test(config.secretAccessKey)
  ) {
    throw new ArtifactStorageError("S3 credentials are invalid.");
  }
  if (controlCharacterPattern.test(config.bucket) || config.bucket.includes("/")) {
    throw new ArtifactStorageError("S3 bucket is invalid.");
  }
}

export function s3ObjectUrl(config: S3ReadConfig, storageKey: ValidatedArtifactKey): URL {
  validateS3Config(config);
  const endpoint = config.endpoint
    ? new URL(config.endpoint)
    : new URL(`https://s3.${config.region}.amazonaws.com`);
  if (
    (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new ArtifactStorageError("S3 endpoint is invalid.");
  }

  const basePath = endpoint.pathname.replace(/\/+$/, "");
  if (config.forcePathStyle) {
    endpoint.pathname = `${basePath}/${config.bucket}/${storageKey.key}`;
  } else {
    if (!dnsBucketPattern.test(config.bucket) || config.bucket.includes("..")) {
      throw new ArtifactStorageError("S3 bucket cannot be used as a host name.");
    }
    endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
    endpoint.pathname = `${basePath}/${storageKey.key}`;
  }
  return endpoint;
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function signedS3GetHeaders(input: {
  readonly config: S3ReadConfig;
  readonly url: URL;
  readonly now: Date;
  readonly range: ArtifactByteRange | undefined;
}): Headers {
  validateS3Config(input.config);
  const isoTimestamp = input.now.toISOString();
  const dateStamp = isoTimestamp.slice(0, 10).replaceAll("-", "");
  const amzTimestamp = `${dateStamp}T${isoTimestamp.slice(11, 19).replaceAll(":", "")}Z`;
  const canonicalHeaderValues = new Map<string, string>([
    ["host", input.url.host],
    ["x-amz-content-sha256", emptyPayloadSha256],
    ["x-amz-date", amzTimestamp],
  ]);
  if (input.range) {
    canonicalHeaderValues.set("range", `bytes=${input.range.start}-${input.range.end}`);
  }
  const signedHeaderNames = [...canonicalHeaderValues.keys()].sort();
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${canonicalHeaderValues.get(name) ?? ""}\n`)
    .join("");
  const canonicalRequest = [
    "GET",
    input.url.pathname,
    input.url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    emptyPayloadSha256,
  ].join("\n");
  const credentialScope = `${dateStamp}/${input.config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzTimestamp,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${input.config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, input.config.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const headers = new Headers({
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-content-sha256": emptyPayloadSha256,
    "x-amz-date": amzTimestamp,
  });
  if (input.range) headers.set("Range", `bytes=${input.range.start}-${input.range.end}`);
  return headers;
}

export async function fetchS3Artifact(input: {
  readonly config: S3ReadConfig;
  readonly storageKey: ValidatedArtifactKey;
  readonly range: ArtifactByteRange | undefined;
}): Promise<Response> {
  const url = s3ObjectUrl(input.config, input.storageKey);
  const headers = signedS3GetHeaders({
    config: input.config,
    url,
    now: new Date(),
    range: input.range,
  });
  try {
    return await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new ArtifactStorageError("S3 artifact request failed.");
  }
}

function safeMediaType(mediaType: string): string {
  switch (mediaType.toLocaleLowerCase("en-US")) {
    case "image/png":
      return "image/png";
    case "video/webm":
      return "video/webm";
    case "application/json":
      return "application/json";
    case "application/zip":
      return "application/zip";
    case "text/plain":
    case "text/plain; charset=utf-8":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export function artifactResponseHeaders(input: {
  readonly fileName: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly size: number;
  readonly range: ArtifactByteRange | undefined;
}): Headers {
  if (!Number.isSafeInteger(input.size) || input.size < 0) {
    throw new ArtifactStorageError("Artifact size metadata is invalid.");
  }
  if (!sha256Pattern.test(input.sha256)) {
    throw new ArtifactStorageError("Artifact digest metadata is invalid.");
  }
  const mediaType = safeMediaType(input.mediaType);
  const disposition =
    mediaType === "application/octet-stream" || mediaType === "application/zip"
      ? "attachment"
      : "inline";
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Disposition": `${disposition}; filename="${input.fileName}"`,
    "Content-Length": String(input.range?.length ?? input.size),
    "Content-Type": mediaType,
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
  if (mediaType !== "image/png" && mediaType !== "video/webm") {
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  }
  if (input.range) {
    headers.set("Content-Range", `bytes ${input.range.start}-${input.range.end}/${input.size}`);
  }
  const normalizedSha256 = input.sha256.toLowerCase();
  headers.set(
    "Content-Digest",
    `sha-256=:${Buffer.from(normalizedSha256, "hex").toString("base64")}:`,
  );
  headers.set("ETag", `"${normalizedSha256}"`);
  return headers;
}

export function rangeNotSatisfiableHeaders(size: number): Headers {
  return new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Range": `bytes */${size}`,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
}
