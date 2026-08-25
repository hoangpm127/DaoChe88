const baseUrl = (process.env.DEPLOY_HEALTH_URL || process.argv[2] || "").trim().replace(/\/$/, "");
if (!/^https?:\/\//.test(baseUrl)) throw new Error("Cần DEPLOY_HEALTH_URL hoặc URL ở đối số đầu tiên.");

for (const path of ["/api/health/live", "/api/health"]) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(30_000), headers: { "user-agent": "tp88-post-deploy-check/1" } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(`${path} không healthy: HTTP ${response.status}`);
  console.log(JSON.stringify({ path, status: response.status, body }));
}
