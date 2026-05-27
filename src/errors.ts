/**
 * GitOpsError — uniform error envelope returned by every provider method.
 * The meta route handler maps `code` to an HTTP status; provider impls
 * throw these instead of raw `Error` so the surface stays predictable.
 */

export type GitOpsErrorCode =
  | "AUTH"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "FORBIDDEN"
  | "UPSTREAM"
  | "INVALID";

export class GitOpsError extends Error {
  readonly code: GitOpsErrorCode;
  readonly upstreamStatus?: number;
  readonly retryAfterSeconds?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: GitOpsErrorCode,
    message: string,
    opts?: {
      upstreamStatus?: number;
      retryAfterSeconds?: number;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "GitOpsError";
    this.code = code;
    this.upstreamStatus = opts?.upstreamStatus;
    this.retryAfterSeconds = opts?.retryAfterSeconds;
    this.details = opts?.details;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: this.message,
      code: this.code,
      upstreamStatus: this.upstreamStatus,
      retryAfterSeconds: this.retryAfterSeconds,
      details: this.details,
    };
  }

  static fromUnknown(err: unknown): GitOpsError {
    if (err instanceof GitOpsError) return err;
    if (err instanceof Error) {
      return new GitOpsError("UPSTREAM", err.message);
    }
    return new GitOpsError("UPSTREAM", String(err));
  }
}

export function httpStatusForCode(code: GitOpsErrorCode): number {
  switch (code) {
    case "AUTH":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "RATE_LIMITED":
      return 429;
    case "UPSTREAM":
      return 502;
    case "INVALID":
      return 400;
  }
}
