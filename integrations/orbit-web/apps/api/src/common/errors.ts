// Every error the API sends has one shape: { error: { code, message, details? } }.
import { ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { ApiErrorBody, Checked } from "@orbit-web/contracts";
import type { Response } from "express";
import { DomainError, type RefusalKind } from "../contexts/shared/domain.js";
import { redactSecrets } from "../infra/security/redact.js";

const DOMAIN_STATUS: Record<RefusalKind, number> = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  stale: 412,
  unprocessable: 422,
  unavailable: 503,
};

export class ApiError extends HttpException {
  constructor(status: number, readonly code: string, message: string, readonly details?: unknown) {
    super({ error: { code, message, ...(details !== undefined ? { details } : {}) } } satisfies ApiErrorBody, status);
    this.message = message;
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(HttpStatus.BAD_REQUEST, "invalid_request", message, details);
export const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, "not_found", `${what} was not found`);
export const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, code, message);
export const unavailable = (code: string, message: string) => new ApiError(HttpStatus.SERVICE_UNAVAILABLE, code, message);
export const forbidden = (code: string, message: string) => new ApiError(HttpStatus.FORBIDDEN, code, message);

// The value a validator accepted, or a 400 naming every problem.
export function accepted<T>(result: Checked<T>): T {
  if (result.ok) return result.value;
  throw badRequest(result.errors.join("; "), { errors: result.errors });
}

const CODES: Record<number, string> = {
  400: "invalid_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  429: "too_many_requests",
};

function bodyOf(exception: HttpException): ApiErrorBody {
  const response = exception.getResponse();
  if (typeof response === "object" && response !== null && "error" in response && typeof (response as ApiErrorBody).error?.code === "string") return response as ApiErrorBody;
  const status = exception.getStatus();
  const message = typeof response === "string" ? response : String((response as { message?: unknown }).message ?? exception.message);
  return { error: { code: CODES[status] ?? "error", message } };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("Api");

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      res.end();
      return;
    }
    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(bodyOf(exception));
      return;
    }
    // A command the domain refused, in its own words: the kind says the status.
    if (exception instanceof DomainError) {
      res.status(DOMAIN_STATUS[exception.kind]).json({ error: { code: exception.code, message: exception.message, ...(exception.details !== undefined ? { details: exception.details } : {}) } } satisfies ApiErrorBody);
      return;
    }
    const status = (exception as { status?: number; type?: string }).status;
    if (status === 413 || status === 400) {
      res.status(status).json({ error: { code: CODES[status], message: status === 413 ? "The request body is too large." : "The request body is not valid JSON." } });
      return;
    }
    this.logger.error(redactSecrets(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)));
    res.status(500).json({ error: { code: "internal_error", message: "Something went wrong inside Orbit Web. The server log has the details." } });
  }
}
