import { OperationsError } from "./operations-types.ts";

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && (character === "," || character === ";")) {
      row.push(cell.trim());
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizedHeader(value: string) {
  return value.replace(/^\uFEFF/, "").normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function column(headers: string[], names: string[], required = true) {
  const index = headers.findIndex((header) => names.includes(header));
  if (index < 0 && required) throw new OperationsError(`Sao kê thiếu cột ${names[0]}.`, 400, "statement_column_missing");
  return index;
}

function money(value: string) {
  const normalized = value.replace(/[.\s₫đ]/gi, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new OperationsError(`Số tiền sao kê không hợp lệ: ${value}.`, 400, "invalid_statement_amount");
  return parsed;
}

export function parseBankStatementCsv(text: string) {
  const table = parseCsv(text);
  if (table.length < 2) throw new OperationsError("File sao kê không có dòng dữ liệu.", 400, "empty_statement");
  const headers = table[0].map(normalizedHeader);
  const transactionId = column(headers, ["provider_transaction_id", "providertransactionid", "transaction_id", "transactionid", "ma_giao_dich", "reference", "reference_code"], false);
  const transactionDate = column(headers, ["transaction_date", "transactiondate", "ngay_giao_dich", "date", "thoi_gian"]);
  const amount = column(headers, ["amount", "transfer_amount", "so_tien", "credit", "ghi_co"]);
  const content = column(headers, ["content", "noi_dung", "description", "dien_giai"]);
  const paymentCode = column(headers, ["payment_code", "paymentcode", "ma_thanh_toan"], false);
  return table.slice(1).map((values) => ({
    providerTransactionId: transactionId >= 0 ? values[transactionId] || "" : "",
    transactionDate: values[transactionDate] || "",
    amount: money(values[amount] || ""),
    content: values[content] || "",
    paymentCode: paymentCode >= 0 ? values[paymentCode] || "" : "",
  }));
}
