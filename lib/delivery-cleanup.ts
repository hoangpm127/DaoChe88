import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { deleteImageFile } from "./storage.ts";
import { queryRows } from "./operations-sql.ts";
import { resolveSetting } from "./settings-store.ts";

export async function cleanupDeliveryData(database: RuntimeDatabase, now = new Date()) {
  const [locationRetentionSeconds, photoRetentionSeconds] = await Promise.all([
    resolveSetting<number>(database, "delivery.shipper_location_retention_seconds"),
    resolveSetting<number>(database, "delivery.pod_photo_retention_seconds"),
  ]);
  const locationCutoff = new Date(now.getTime() - locationRetentionSeconds * 1_000).toISOString();
  const photoCutoff = new Date(now.getTime() - photoRetentionSeconds * 1_000).toISOString();
  const expiredPhotos = await queryRows<{ id: string; photoUrl: string }>(database.prepare(`SELECT id, photo_url FROM delivery_proofs
    WHERE proof_type = 'photo' AND photo_url != '' AND captured_at < ? ORDER BY captured_at LIMIT 500`).bind(photoCutoff));
  let deletedFiles = 0;
  for (const proof of expiredPhotos) {
    const name = new URL(proof.photoUrl, "http://localhost").searchParams.get("name") || "";
    if (await deleteImageFile("pod", name)) deletedFiles += 1;
  }
  if (expiredPhotos.length) {
    const ids = expiredPhotos.map(() => "?").join(",");
    await database.prepare(`UPDATE delivery_proofs SET photo_url = '' WHERE id IN (${ids})`).bind(...expiredPhotos.map((proof) => proof.id)).run();
  }
  const removedLocations = await database.prepare("DELETE FROM shipper_locations WHERE recorded_at < ?").bind(locationCutoff).run();
  const removedQuotes = await database.prepare("DELETE FROM delivery_quotes WHERE provider = 'checkout' AND status = 'checkout' AND expires_at < ?").bind(now.toISOString()).run();
  return {
    locationCutoff,
    photoCutoff,
    removedLocations: Number(removedLocations.meta.changes || 0),
    expiredPhotos: expiredPhotos.length,
    deletedFiles,
    removedQuotes: Number(removedQuotes.meta.changes || 0),
  };
}
