import { getApiBase } from "../ApiBase";
import { getPersistentID } from "../Auth";

// Client for the self-hosted server's shared gallery of player uploads
// (src/server/SelfHostUploads.ts).

export type UploadKind = "skin" | "flag" | "pattern";

export interface UploadedItem {
  id: string;
  name: string;
  kind: UploadKind;
  title: string;
  uploader: string;
  createdAt: number;
  url?: string;
  mine: boolean;
}

export interface UploadsListing {
  limits: { maxBytes: number; perOwner: number };
  items: UploadedItem[];
}

export interface NewUpload {
  kind: UploadKind;
  title: string;
  password: string;
  /** PNG bytes, base64 (skin/flag). */
  image?: string;
  /** Encoded pattern bitmap (pattern). */
  pattern?: string;
}

/** Server error code ("wrong_password", "limit_reached", …) or "network". */
export class UploadRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const base = () => `${getApiBase()}/uploads`;

async function failure(res: Response): Promise<UploadRequestError> {
  try {
    const body = (await res.json()) as { error?: string };
    return new UploadRequestError(body.error ?? `http_${res.status}`);
  } catch {
    return new UploadRequestError(res.status === 413 ? "too_big" : "network");
  }
}

export async function listUploads(): Promise<UploadsListing> {
  let res: Response;
  try {
    res = await fetch(base(), {
      headers: { "x-bf-owner": getPersistentID() },
      cache: "no-store",
    });
  } catch {
    throw new UploadRequestError("network");
  }
  if (!res.ok) throw await failure(res);
  return (await res.json()) as UploadsListing;
}

export async function uploadCosmetic(upload: NewUpload): Promise<string> {
  let res: Response;
  try {
    res = await fetch(base(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...upload,
        owner: getPersistentID(),
        uploader: localStorage.getItem("username") ?? "",
      }),
    });
  } catch {
    throw new UploadRequestError("network");
  }
  if (!res.ok) throw await failure(res);
  return ((await res.json()) as { name: string }).name;
}

export async function deleteUpload(id: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${base()}/${id}`, {
      method: "DELETE",
      headers: { "x-bf-owner": getPersistentID() },
    });
  } catch {
    throw new UploadRequestError("network");
  }
  if (!res.ok) throw await failure(res);
}
