export const dynamic = "force-dynamic";

// Railway only needs to know that the HTTP process can accept requests. The
// deeper /api/health check also audits integrations and production data; those
// failures must stay observable without causing Railway to kill a live server.
export async function GET() {
  return Response.json({
    ok: true,
    status: "alive",
    checkedAt: new Date().toISOString(),
  }, {
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  });
}
