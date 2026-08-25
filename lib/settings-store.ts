import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { getPortalRolePolicy, isPortalRole } from "./portal-access.ts";
import { queryRows } from "./operations-sql.ts";
import {
  SETTINGS_REGISTRY,
  defaultSettingValue,
  settingDefinition,
  validateSettingValue,
  type SettingDefinition,
  type SettingScopeType,
  type SettingValue,
} from "./settings-registry.ts";
import { OperationsError, type Actor } from "./operations-types.ts";

type StoredSettingRow = {
  key: string;
  scopeType: SettingScopeType;
  scopeValue: string;
  valueJson: string;
  updatedBy: string;
  updatedAt: string;
};

export type SettingHistoryRow = {
  id: string;
  key: string;
  scopeType: SettingScopeType;
  scopeValue: string;
  oldValueJson: string | null;
  newValueJson: string;
  reason: string;
  changedBy: string;
  changedAt: string;
};

type CachedSettings = { loadedAt: number; rows: Map<string, StoredSettingRow> };
const cache = new WeakMap<object, CachedSettings>();
const CACHE_TTL_MS = 60_000;

function rowKey(key: string, scopeType: SettingScopeType, scopeValue: string) {
  return `${key}\u0000${scopeType}\u0000${scopeValue}`;
}

function normalizedRole(role: string) {
  if (role === "super-admin") return "owner";
  if (role === "finance") return "accountant";
  if (["manager", "distribution"].includes(role)) return "store-owner";
  return role;
}

export function actorIdentifier(actor: Actor) {
  return actor.userId?.trim() || actor.name || actor.role;
}

function actorSiteIds(actor: Actor) {
  const withScope = actor as Actor & { siteIds?: string[] };
  if (Array.isArray(withScope.siteIds)) return withScope.siteIds;
  if (actor.scope) return [...actor.scope.siteIds];
  if (isPortalRole(actor.role)) return getPortalRolePolicy(actor.role).siteIds;
  return [];
}

function roleAllowed(actor: Actor, roles: string[]) {
  return roles.includes(actor.role) || roles.includes(normalizedRole(actor.role));
}

export function canEditSetting(actor: Actor, definition: SettingDefinition, scopeType: SettingScopeType, scopeValue: string) {
  if (scopeType === "global") return roleAllowed(actor, definition.editableRoles);
  if (!definition.allowSiteOverride || !roleAllowed(actor, definition.siteEditableRoles || definition.editableRoles)) return false;
  if (normalizedRole(actor.role) === "owner") return true;
  return actorSiteIds(actor).includes(scopeValue);
}

export function assertCanEditSetting(actor: Actor, definition: SettingDefinition, scopeType: SettingScopeType, scopeValue: string) {
  if (scopeType === "global" && normalizedRole(actor.role) === "store-owner") {
    throw new OperationsError("Chủ cửa hàng không được sửa thông số toàn hệ thống.", 403, "global_setting_forbidden");
  }
  if (!canEditSetting(actor, definition, scopeType, scopeValue)) {
    throw new OperationsError("Bạn không được sửa thông số này trong phạm vi đã chọn.", 403, "setting_scope_forbidden");
  }
}

async function loadRows(database: RuntimeDatabase) {
  const existing = cache.get(database as object);
  if (existing && Date.now() - existing.loadedAt < CACHE_TTL_MS) return existing.rows;
  const stored = await queryRows<StoredSettingRow>(database.prepare("SELECT key, scope_type, scope_value, value_json, updated_by, updated_at FROM system_settings"));
  const rows = new Map(stored.map((row) => [rowKey(row.key, row.scopeType, row.scopeValue), row]));
  cache.set(database as object, { loadedAt: Date.now(), rows });
  return rows;
}

export function invalidateSettingsCache(database: RuntimeDatabase) {
  cache.delete(database as object);
}

export async function storedSetting(database: RuntimeDatabase, key: string, scopeType: SettingScopeType, scopeValue: string) {
  return (await loadRows(database)).get(rowKey(key, scopeType, scopeValue)) || null;
}

function valueOf(row: StoredSettingRow | null, definition: SettingDefinition) {
  if (!row) return null;
  try {
    return validateSettingValue(definition, JSON.parse(row.valueJson));
  } catch {
    return null;
  }
}

export async function resolveSetting<T extends SettingValue = SettingValue>(database: RuntimeDatabase, key: string, siteId?: string | null): Promise<T> {
  const definition = settingDefinition(key);
  if (!definition) throw new OperationsError(`Thông số ${key} chưa được đăng ký.`, 500, "unknown_setting");
  const rows = await loadRows(database);
  if (siteId && definition.allowSiteOverride) {
    const siteValue = valueOf(rows.get(rowKey(key, "site", siteId)) || null, definition);
    if (siteValue !== null) return siteValue as T;
  }
  const globalValue = valueOf(rows.get(rowKey(key, "global", "*")) || null, definition);
  return (globalValue === null ? defaultSettingValue(key) : globalValue) as T;
}

export async function listSettingsForActor(database: RuntimeDatabase, actor: Actor) {
  const rows = await loadRows(database);
  const visibleDefinitions = SETTINGS_REGISTRY.filter((definition) =>
    canEditSetting(actor, definition, "global", "*")
    || (definition.allowSiteOverride && (definition.siteEditableRoles || definition.editableRoles).some((role) => roleAllowed(actor, [role]))),
  );
  const siteRows = await queryRows<{ id: string; name: string }>(database.prepare("SELECT id, name FROM operation_sites ORDER BY name"));
  const allowedSiteIds = normalizedRole(actor.role) === "owner" ? null : new Set(actorSiteIds(actor));
  const sites = allowedSiteIds === null ? siteRows : siteRows.filter((site) => allowedSiteIds.has(site.id));

  return {
    cacheTtlSeconds: CACHE_TTL_MS / 1_000,
    sites,
    settings: visibleDefinitions.map((definition) => {
      const globalRow = rows.get(rowKey(definition.key, "global", "*")) || null;
      const globalValue = valueOf(globalRow, definition);
      const currentValue = globalValue ?? defaultSettingValue(definition.key);
      const overrides = definition.allowSiteOverride
        ? sites.flatMap((site) => {
          const row = rows.get(rowKey(definition.key, "site", site.id)) || null;
          const value = valueOf(row, definition);
          return value === null ? [] : [{ siteId: site.id, siteName: site.name, value, updatedBy: row!.updatedBy, updatedAt: row!.updatedAt }];
        })
        : [];
      return {
        ...definition,
        currentValue,
        source: globalRow && globalValue !== null ? "global" : "default",
        updatedBy: globalRow?.updatedBy || "Hệ thống",
        updatedAt: globalRow?.updatedAt || null,
        canEditGlobal: canEditSetting(actor, definition, "global", "*"),
        canEditSite: definition.allowSiteOverride && sites.some((site) => canEditSetting(actor, definition, "site", site.id)),
        siteOverrides: overrides,
      };
    }),
  };
}

export async function settingHistory(database: RuntimeDatabase, actor: Actor, key: string, limit = 100) {
  const definition = settingDefinition(key);
  if (!definition) throw new OperationsError("Thông số không tồn tại trong sổ đăng ký.", 404, "unknown_setting");
  const canReadGlobal = canEditSetting(actor, definition, "global", "*");
  const siteIds = normalizedRole(actor.role) === "owner" ? null : actorSiteIds(actor);
  if (!canReadGlobal && (!definition.allowSiteOverride || siteIds?.length === 0)) {
    throw new OperationsError("Bạn không được xem lịch sử thông số này.", 403, "setting_history_forbidden");
  }
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = await queryRows<SettingHistoryRow>(database.prepare(`SELECT * FROM system_setting_history
    WHERE key = ? ORDER BY changed_at DESC LIMIT ?`).bind(key, safeLimit));
  return siteIds === null || canReadGlobal ? rows : rows.filter((row) => row.scopeType === "site" && siteIds.includes(row.scopeValue));
}

