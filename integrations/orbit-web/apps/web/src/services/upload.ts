// An upload with its progress: the file's own bytes as the request body (application/octet-stream), its name in a
// header -- never a form -- and the header every change carries. XMLHttpRequest, because it reports progress.
import { CSRF_HEADER, MUTATION_HEADER, UPLOAD_NAME_HEADER, type ApiErrorBody } from "@orbit-web/contracts";
import { sessionCsrf } from "./account";
import { ApiError } from "./api";

const jsonOf = (text: string): unknown => {
  try {
    return text.length > 0 ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
};

export function uploadFile<T>(path: string, file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.withCredentials = true;
    xhr.setRequestHeader(MUTATION_HEADER, "1");
    const csrf = sessionCsrf();
    if (csrf !== null) xhr.setRequestHeader(CSRF_HEADER, csrf);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader(UPLOAD_NAME_HEADER, encodeURIComponent(file.name));
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = jsonOf(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as T);
      const err = (body as ApiErrorBody | null)?.error;
      reject(new ApiError(xhr.status, err?.code ?? "error", err?.message ?? `${xhr.status} ${xhr.statusText}`));
    };
    xhr.onerror = () => reject(new ApiError(0, "network", "The upload could not reach Orbit Web."));
    xhr.onabort = () => reject(new ApiError(0, "aborted", "The upload was cancelled."));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}
