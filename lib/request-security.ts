export function requestUsesHttps(request: Request) {
  if (new URL(request.url).protocol === "https:") return true;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0].trim().toLocaleLowerCase();
  if (forwardedProto === "https") return true;
  const forwarded = request.headers.get("forwarded") || "";
  return /(?:^|[;,]\s*)proto=https(?:[;,]|$)/i.test(forwarded);
}
