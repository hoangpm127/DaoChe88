import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { boundedText, readInteger, readIsoDate, readString } from "./command-input.ts";
import { assertActor, operationEvent } from "./command-guards.ts";
import type { CommandContext } from "./commands-orders.ts";
import { invoiceProvider } from "./einvoice.ts";
import { eventStatement, queryRows } from "./operations-sql.ts";
import { actorCanAccessSite } from "./supply-chain-store.ts";
import { OperationsError } from "./operations-types.ts";

export async function assertLedgerPeriodOpen(database: RuntimeDatabase, occurredAt: string) {
  const closed = await database.prepare(`SELECT period_code FROM accounting_periods
    WHERE status = 'closed' AND ? >= starts_at AND ? < ends_at LIMIT 1`).bind(occurredAt, occurredAt).first("period_code");
  if (closed) throw new OperationsError(`Kỳ ${closed} đã khóa; phải ghi bút toán đảo ở kỳ hiện tại.`, 409, "accounting_period_closed");
}

function actorId(context: CommandContext) {
  return context.actor.userId || context.actor.name;
}

export async function handleFinanceComplianceCommands(database: RuntimeDatabase, context: CommandContext) {
  const { command, actor, data, now } = context;
  const userId = actorId(context);

  if (command === "internal.credit-limit.set") {
    assertActor(actor, ["owner", "super-admin"], "đặt hạn mức công nợ nội bộ");
    const siteId = readString(data, "siteId");
    const creditLimit = readInteger(data, "creditLimit", { min: 0, max: 100_000_000_000 });
    if (!await database.prepare("SELECT id FROM operation_sites WHERE id = ?").bind(siteId).first("id")) throw new OperationsError("Không tìm thấy điểm bán.", 404, "site_not_found");
    await database.batch([
      database.prepare(`INSERT INTO internal_accounts (id, site_id, balance, credit_limit, updated_at)
        VALUES (?, ?, 0, ?, ?) ON CONFLICT(site_id) DO UPDATE SET credit_limit = excluded.credit_limit, updated_at = excluded.updated_at`)
        .bind(`internal-account-${siteId}`, siteId, creditLimit, now),
      eventStatement(database, operationEvent("internal-account", siteId, command, actor, null, String(creditLimit), { creditLimit })),
    ]);
    return { command, siteId, creditLimit };
  }

  if (command === "internal.payment") {
    assertActor(actor, ["owner", "super-admin", "accountant", "finance", "store-owner"], "ghi thanh toán công nợ nội bộ");
    const siteId = readString(data, "siteId");
    if (!actor.scope?.isGlobal && !actorCanAccessSite(actor, siteId)) throw new OperationsError("Công nợ nằm ngoài phạm vi phiên.", 403, "entity_out_of_scope");
    const amount = readInteger(data, "amount", { min: 1, max: 100_000_000_000 });
    const paymentReference = boundedText(data, "paymentReference", 120);
    const account = (await queryRows<{ balance: number; updatedAt: string }>(database.prepare("SELECT balance, updated_at FROM internal_accounts WHERE site_id = ? LIMIT 1").bind(siteId)))[0];
    if (!account) throw new OperationsError("Điểm chưa phát sinh công nợ nội bộ.", 404, "internal_account_not_found");
    if (amount > Number(account.balance)) throw new OperationsError("Số tiền thanh toán vượt dư nợ hiện tại.", 409, "internal_payment_exceeds_balance", { balance: account.balance });
    await assertLedgerPeriodOpen(database, now);
    const balanceAfter = Number(account.balance) - amount;
    const id = crypto.randomUUID();
    const results = await database.batch([
      database.prepare("UPDATE internal_accounts SET balance = ?, last_settled_at = ?, updated_at = ? WHERE site_id = ? AND balance = ? AND updated_at = ?").bind(balanceAfter, now, now, siteId, account.balance, account.updatedAt),
      database.prepare(`INSERT INTO internal_account_entries
        (id, site_id, entry_type, amount, balance_after, transfer_id, payment_reference, description, created_by, created_at)
        VALUES (?, ?, 'payment', ?, ?, NULL, ?, ?, ?, ?)`)
        .bind(id, siteId, -amount, balanceAfter, paymentReference, boundedText(data, "description", 300, false) || "Cửa hàng thanh toán công nợ bếp", userId, now),
      eventStatement(database, operationEvent("internal-account", siteId, command, actor, String(account.balance), String(balanceAfter), { amount, paymentReference })),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Số dư vừa được cập nhật bởi phiên khác.", 409, "internal_payment_conflict");
    return { command, entryId: id, siteId, amount, balanceAfter };
  }

  if (command === "accounting-period.close") {
    assertActor(actor, ["owner", "super-admin", "accountant", "finance", "control"], "khóa sổ kỳ");
    const periodCode = readString(data, "periodCode");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodCode)) throw new OperationsError("Mã kỳ phải có dạng YYYY-MM.", 400, "invalid_period_code");
    const startsAt = readString(data, "startsAt", false) ? readIsoDate(data, "startsAt") : `${periodCode}-01T00:00:00.000Z`;
    const start = new Date(startsAt);
    const endsAt = readString(data, "endsAt", false) ? readIsoDate(data, "endsAt") : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString();
    if (endsAt <= startsAt) throw new OperationsError("Ngày kết thúc kỳ phải sau ngày bắt đầu.", 400, "invalid_accounting_period");
    const existing = (await queryRows<{ id: string; status: string; updatedAt: string }>(database.prepare("SELECT id, status, updated_at FROM accounting_periods WHERE period_code = ? LIMIT 1").bind(periodCode)))[0];
    if (existing?.status === "closed") return { command, periodId: existing.id, periodCode, status: "closed", duplicate: true };
    const id = existing?.id || crypto.randomUUID();
    const results = existing
      ? await database.batch([
          database.prepare("UPDATE accounting_periods SET status = 'closed', closed_by = ?, closed_at = ?, note = ?, updated_at = ? WHERE id = ? AND status != 'closed' AND updated_at = ?").bind(userId, now, boundedText(data, "note", 500, false), now, id, existing.updatedAt),
          eventStatement(database, operationEvent("accounting-period", id, command, actor, existing.status, "closed", { periodCode, startsAt, endsAt })),
        ])
      : await database.batch([
          database.prepare(`INSERT INTO accounting_periods
            (id, period_code, starts_at, ends_at, status, closed_by, closed_at, note, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'closed', ?, ?, ?, ?, ?)`)
            .bind(id, periodCode, startsAt, endsAt, userId, now, boundedText(data, "note", 500, false), now, now),
          eventStatement(database, operationEvent("accounting-period", id, command, actor, null, "closed", { periodCode, startsAt, endsAt })),
        ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Kỳ vừa được khóa bởi phiên khác.", 409, "accounting_period_close_conflict");
    return { command, periodId: id, periodCode, startsAt, endsAt, status: "closed" };
  }

  if (command === "einvoice.defer") {
    assertActor(actor, ["owner", "super-admin", "accountant", "finance", "store-owner"], "lưu yêu cầu hóa đơn");
    const orderId = readString(data, "orderId");
    const order = (await queryRows<{ id: string; siteId: string; totalAmount: number; orderCode: string }>(database.prepare("SELECT id, site_id, total_amount, order_code FROM operation_orders WHERE id = ? LIMIT 1").bind(orderId)))[0];
    if (!order) throw new OperationsError("Không tìm thấy đơn hàng.", 404, "order_not_found");
    if (!actor.scope?.isGlobal && !actorCanAccessSite(actor, order.siteId)) throw new OperationsError("Đơn hàng nằm ngoài phạm vi phiên.", 403, "entity_out_of_scope");
    const buyerName = boundedText(data, "buyerName", 180);
    const buyerTaxCode = boundedText(data, "buyerTaxCode", 30, false);
    const buyerAddress = boundedText(data, "buyerAddress", 300, false);
    const buyerEmail = boundedText(data, "buyerEmail", 254, false);
    if (buyerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) throw new OperationsError("Email nhận hóa đơn không hợp lệ.", 400, "invalid_email");
    const vatRateBps = readInteger(data, "vatRateBps", { min: 0, max: 10_000, required: false });
    const totalAmount = Number(order.totalAmount);
    const subtotal = vatRateBps > 0 ? Math.round(totalAmount * 10_000 / (10_000 + vatRateBps)) : totalAmount;
    const vatAmount = totalAmount - subtotal;
    const id = crypto.randomUUID();
    const providerResult = await invoiceProvider.issue({ invoiceId: id, orderId, buyerName, buyerTaxCode, buyerAddress, buyerEmail, totalAmount });
    await database.batch([
      database.prepare(`INSERT INTO einvoices
        (id, order_id, provider, buyer_name, buyer_tax_code, buyer_address, buyer_email, subtotal,
         vat_rate_bps, vat_amount, total_amount, status, provider_payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deferred', ?, ?, ?)
        ON CONFLICT(order_id) DO UPDATE SET buyer_name = excluded.buyer_name, buyer_tax_code = excluded.buyer_tax_code,
          buyer_address = excluded.buyer_address, buyer_email = excluded.buyer_email, subtotal = excluded.subtotal,
          vat_rate_bps = excluded.vat_rate_bps, vat_amount = excluded.vat_amount, total_amount = excluded.total_amount,
          status = 'deferred', provider_payload = excluded.provider_payload, updated_at = excluded.updated_at`)
        .bind(id, orderId, providerResult.provider, buyerName, buyerTaxCode, buyerAddress, buyerEmail, subtotal, vatRateBps, vatAmount, totalAmount, JSON.stringify(providerResult.payload), now, now),
      eventStatement(database, operationEvent("einvoice", orderId, command, actor, null, "deferred", { orderCode: order.orderCode, buyerTaxCode, totalAmount })),
    ]);
    return { command, invoiceId: id, orderId, status: "deferred", provider: providerResult.provider, subtotal, vatAmount, totalAmount };
  }

  return null;
}
