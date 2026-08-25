import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { readString } from "./command-input.ts";
import { operationEvent } from "./command-guards.ts";
import { eventStatement, queryRows } from "./operations-sql.ts";
import { defaultSettingValue, settingDefinition, validateSettingValue, type SettingScopeType, type SettingValue } from "./settings-registry.ts";
import { actorIdentifier, assertCanEditSetting, invalidateSettingsCache, resolveSetting, storedSetting } from "./settings-store.ts";
import { OperationsError, type Actor, type JsonRecord, type OperationsCommand } from "./operations-types.ts";

type SettingsCommandContext = { command: OperationsCommand; actor: Actor; data: JsonRecord; now: string };

function scopeFrom(data: JsonRecord) {
  const scopeType = (readString(data, "scopeType", false) || "global") as SettingScopeType;
  if (!(["global", "site"] as string[]).includes(scopeType)) throw new OperationsError("Phạm vi thông số không hợp lệ.", 400, "invalid_setting_scope");
  const scopeValue = scopeType === "global" ? "*" : readString(data, "scopeValue");
  return { scopeType, scopeValue };
}

async function assertSiteExists(database: RuntimeDatabase, scopeType: SettingScopeType, scopeValue: string) {
  if (scopeType !== "site") return;
  const rows = await queryRows<{ id: string }>(database.prepare("SELECT id FROM operation_sites WHERE id = ? LIMIT 1").bind(scopeValue));
  if (!rows[0]) throw new OperationsError("Điểm bán dùng để ghi đè không tồn tại.", 404, "site_not_found");
}

function affiliateTierMigrationStatements(database: RuntimeDatabase, key: string, oldValue: SettingValue, newValue: SettingValue, now: string) {
  if (key !== "commission.affiliate_tiers_bps" || !Array.isArray(oldValue) || !Array.isArray(newValue)) return [];
  return oldValue.flatMap((oldTier, index) => {
    const nextTier = newValue[index];
    if (typeof oldTier !== "number" || typeof nextTier !== "number" || oldTier === nextTier || oldTier === 0) return [];
    return [database.prepare("UPDATE affiliate_members SET commission_bps = ?, updated_at = ? WHERE commission_bps = ?").bind(nextTier, now, oldTier)];
  });
}

export async function handleSettingsCommands(database: RuntimeDatabase, context: SettingsCommandContext) {
  const { command, actor, data, now } = context;
  if (command !== "settings.update" && command !== "settings.reset") return null;

  const key = readString(data, "key");
  const definition = settingDefinition(key);
  if (!definition) throw new OperationsError("Thông số không tồn tại trong sổ đăng ký.", 404, "unknown_setting");
  const { scopeType, scopeValue } = scopeFrom(data);
  if (scopeType === "site" && !definition.allowSiteOverride) throw new OperationsError("Thông số này chỉ áp dụng toàn hệ thống.", 400, "site_override_not_allowed");
  assertCanEditSetting(actor, definition, scopeType, scopeValue);
  await assertSiteExists(database, scopeType, scopeValue);
  const current = await storedSetting(database, key, scopeType, scopeValue);
  const fallback = scopeType === "site" ? await resolveSetting(database, key) : defaultSettingValue(key);
  const oldValue = current ? validateSettingValue(definition, JSON.parse(current.valueJson)) : fallback;
  const reason = readString(data, "reason", false).slice(0, 500);
  const changedBy = actorIdentifier(actor);
  const historyId = crypto.randomUUID();

  if (command === "settings.update") {
    const nextValue = validateSettingValue(definition, data.value);
    if (JSON.stringify(nextValue) === JSON.stringify(oldValue) && current) return { command, key, scopeType, scopeValue, value: nextValue, duplicate: true };
    const event = operationEvent("system-setting", `${key}:${scopeType}:${scopeValue}`, command, actor, JSON.stringify(oldValue), JSON.stringify(nextValue), { reason });
    await database.batch([
      database.prepare(`INSERT INTO system_settings (key, scope_type, scope_value, value_json, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key, scope_type, scope_value) DO UPDATE SET
        value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).bind(key, scopeType, scopeValue, JSON.stringify(nextValue), changedBy, now),
      database.prepare(`INSERT INTO system_setting_history (id, key, scope_type, scope_value, old_value_json, new_value_json, reason, changed_by, changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(historyId, key, scopeType, scopeValue, JSON.stringify(oldValue), JSON.stringify(nextValue), reason, changedBy, now),
      ...affiliateTierMigrationStatements(database, key, oldValue, nextValue, now),
      eventStatement(database, event),
    ]);
    invalidateSettingsCache(database);
    return { command, key, scopeType, scopeValue, value: nextValue, historyId };
  }

  if (!current) return { command, key, scopeType, scopeValue, value: fallback, duplicate: true };
  const resetValue = fallback;
  const event = operationEvent("system-setting", `${key}:${scopeType}:${scopeValue}`, command, actor, current.valueJson, JSON.stringify(resetValue), { reason: reason || "Quay về giá trị kế thừa" });
  await database.batch([
    database.prepare("DELETE FROM system_settings WHERE key = ? AND scope_type = ? AND scope_value = ?").bind(key, scopeType, scopeValue),
    database.prepare(`INSERT INTO system_setting_history (id, key, scope_type, scope_value, old_value_json, new_value_json, reason, changed_by, changed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(historyId, key, scopeType, scopeValue, current.valueJson, JSON.stringify(resetValue), reason || "Quay về giá trị kế thừa", changedBy, now),
    ...affiliateTierMigrationStatements(database, key, oldValue, resetValue, now),
    eventStatement(database, event),
  ]);
  invalidateSettingsCache(database);
  return { command, key, scopeType, scopeValue, value: resetValue, historyId, reset: true };
}
