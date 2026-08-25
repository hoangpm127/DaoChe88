import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { sweepRequestRateLimits } from "./rate-limit.ts";
import { sweepRateLimits } from "./auth/rate-limit.ts";

export async function enforceDataRetention(database: RuntimeDatabase, now = new Date()) {
  const applicationLogCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60_000).toISOString();
  const otpCutoff = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const deleteExpiredOtp = async () => {
    try {
      return await database.prepare("DELETE FROM otp_challenges WHERE created_at < ?").bind(otpCutoff).run();
    } catch (error) {
      if (String(error).toLocaleLowerCase("en-US").includes("no such table")) return { meta: { changes: 0 } };
      throw error;
    }
  };
  const [applicationLogs, otp, streamConnections, requestRateLimits, authRateLimits] = await Promise.all([
    database.prepare("DELETE FROM application_request_log WHERE created_at < ?").bind(applicationLogCutoff).run(),
    deleteExpiredOtp(),
    database.prepare("DELETE FROM stream_connections WHERE expires_at < ?").bind(now.toISOString()).run(),
    sweepRequestRateLimits(database, now),
    sweepRateLimits(database, now),
  ]);
  return {
    applicationLogsDeleted: applicationLogs.meta.changes,
    otpChallengesDeleted: otp.meta.changes,
    streamConnectionsDeleted: streamConnections.meta.changes,
    requestRateLimitsDeleted: requestRateLimits,
    authRateLimitsDeleted: authRateLimits,
    policies: { applicationLogsDays: 90, otpDays: 1, accountingYears: 10 },
  };
}
