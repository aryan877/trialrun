import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, resolve, sep } from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface StoredArtifact {
  readonly storageKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface ArtifactStore {
  putFile(reviewId: string, sourcePath: string, label: string, mediaType: string): Promise<StoredArtifact>;
}

async function sha256File(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

function safeName(value: string): string {
  const safe = value.toLocaleLowerCase("en-US").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safe) throw new Error("Artifact label produced an empty file name.");
  return safe.slice(0, 160);
}

export class LocalArtifactStore implements ArtifactStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async putFile(
    reviewId: string,
    sourcePath: string,
    label: string,
  ): Promise<StoredArtifact> {
    if (!/^[0-9a-f-]{36}$/i.test(reviewId)) throw new Error("Invalid review ID for artifact path.");
    const directory = join(this.#root, reviewId);
    const fileName = `${safeName(label)}-${basename(sourcePath)}`;
    const destination = resolve(directory, fileName);
    if (!destination.startsWith(`${directory}${sep}`)) throw new Error("Unsafe artifact destination.");
    await mkdir(directory, { recursive: true });
    await copyFile(sourcePath, destination);
    const metadata = await stat(destination);
    return {
      storageKey: `${reviewId}/${fileName}`,
      sha256: await sha256File(destination),
      sizeBytes: metadata.size,
    };
  }
}

export interface S3ArtifactStoreOptions {
  readonly endpoint?: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}

export class S3ArtifactStore implements ArtifactStore {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(options: S3ArtifactStoreOptions) {
    this.#bucket = options.bucket;
    this.#client = new S3Client({
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async putFile(
    reviewId: string,
    sourcePath: string,
    label: string,
    mediaType: string,
  ): Promise<StoredArtifact> {
    if (!/^[0-9a-f-]{36}$/i.test(reviewId)) throw new Error("Invalid review ID for artifact key.");
    const key = `${reviewId}/${safeName(label)}-${basename(sourcePath)}`;
    const metadata = await stat(sourcePath);
    const sha256 = await sha256File(sourcePath);
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: createReadStream(sourcePath),
        ContentType: mediaType,
        Metadata: { sha256 },
      }),
    );
    return { storageKey: key, sha256, sizeBytes: metadata.size };
  }
}
