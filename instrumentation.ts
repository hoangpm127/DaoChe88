import { reportRuntimeError } from "./lib/runtime-monitoring";

export async function register() {
  // Hook được Vinext/Next nạp một lần khi tiến trình khởi động.
}

export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string; headers?: Record<string, string> },
  context: { routerKind?: string; routePath?: string; routeType?: string },
) {
  await reportRuntimeError(error, {
    path: request.path || context.routePath || "unknown",
    method: request.method || "unknown",
    routeType: context.routeType || context.routerKind || "unknown",
    requestId: request.headers?.["x-request-id"] || "",
  });
}
