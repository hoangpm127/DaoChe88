/** Lỗi nghiệp vụ dùng chung, tách riêng để các module lá không kéo cả operations graph. */
export class OperationsError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(message: string, status = 400, code = "invalid_command", details: Record<string, unknown> = {}) {
    super(message);
    this.name = "OperationsError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
