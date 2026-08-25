import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const outputDir = path.join(root, "data", "seed");

function readSource(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const text = fs.readFileSync(absolutePath, "utf8");
  return {
    relativePath,
    sourceFile: ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
  };
}

function findVariable(name, candidates) {
  for (const relativePath of candidates) {
    if (!fs.existsSync(path.join(root, relativePath))) continue;
    const source = readSource(relativePath);
    for (const statement of source.sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) {
          return { ...source, node: declaration.initializer };
        }
      }
    }
  }
  throw new Error(`Không tìm thấy biến ${name} trong: ${candidates.join(", ")}`);
}

function unwrap(node) {
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

function propertyName(node, sourceFile) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return node.getText(sourceFile);
}

function literalValue(input, sourceFile) {
  const node = unwrap(input);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text.replaceAll("_", ""));
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return -Number(literalValue(node.operand, sourceFile));
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((element) => {
    if (ts.isSpreadElement(element)) {
      const spread = literalValue(element.expression, sourceFile);
      if (!Array.isArray(spread)) throw new Error(`Chỉ hỗ trợ trải mảng dữ liệu tĩnh tại ${sourceFile.fileName}.`);
      return spread;
    }
    return [literalValue(element, sourceFile)];
  });
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property)) return [];
      return [[propertyName(property.name, sourceFile), literalValue(property.initializer, sourceFile)]];
    }));
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "options") {
    const productSku = literalValue(node.arguments[0], sourceFile);
    const entries = literalValue(node.arguments[1], sourceFile);
    return entries.map(([name, priceDelta], index) => ({
      code: `${productSku}.TOPPING.${index + 1}`,
      name,
      priceDelta,
    }));
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "map") {
    const sandbox = Object.create(null);
    const source = `globalThis.__seedValue = (${node.getText(sourceFile)});`;
    const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(javascript, sandbox, { timeout: 1_000 });
    return sandbox.__seedValue;
  }
  throw new Error(`Biểu thức không phải dữ liệu tĩnh tại ${sourceFile.fileName}: ${node.getText(sourceFile).slice(0, 120)}`);
}

function readStaticArray(name, candidates) {
  const found = findVariable(name, candidates);
  const value = literalValue(found.node, found.sourceFile);
  if (!Array.isArray(value)) throw new Error(`${name} không phải là mảng.`);
  return { value, source: found.relativePath };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(filename, headers, rows) {
  const body = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  fs.writeFileSync(path.join(outputDir, filename), `\uFEFF${body}\r\n`, "utf8");
}

function storeCode(id) {
  return `TP88-${id.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toUpperCase()}`;
}

function normalizedKind(kind) {
  if (kind === "Cửa hàng chính thống" || kind === "Điểm bán chính thống") return "official-store";
  if (kind === "Đối tác Affiliate") return "partner-counter";
  if (kind === "Đối tác phân phối") return "distribution-partner";
  return "";
}

const districts = [
  "Ba Đình", "Bắc Từ Liêm", "Cầu Giấy", "Đống Đa", "Hà Đông", "Hai Bà Trưng", "Hoàn Kiếm", "Hoàng Mai",
  "Long Biên", "Nam Từ Liêm", "Tây Hồ", "Thanh Xuân", "Đông Anh", "Gia Lâm", "Hoài Đức", "Thanh Trì",
];

function districtFromAddress(address) {
  return districts.find((district) => address.includes(district)) || "";
}

const orderSources = ["app/order/page.tsx"];
const stores = readStaticArray("storePoints", ["app/order/data/stores.ts", ...orderSources]);
const deliveryLocations = readStaticArray("locations", ["app/order/data/stores.ts", ...orderSources]);
const products = readStaticArray("products", ["app/order/data/products.ts", ...orderSources]);
const catalog = readStaticArray("BOOTSTRAP_CATALOG", ["lib/catalog-store.ts"]);

const catalogBySku = new Map(catalog.value.map((product) => [product.sku, product]));
const productBySku = new Map(products.value.map((product) => [product.id, product]));
const sourceOnlyProducts = products.value.filter((product) => !catalogBySku.has(product.id));
const catalogOnlyProducts = catalog.value.filter((product) => !productBySku.has(product.sku));
const unknownKinds = [...new Set(stores.value.map((store) => store.kind).filter((kind) => !normalizedKind(kind)))];
const missingDistricts = stores.value.filter((store) => !districtFromAddress(store.address));

fs.mkdirSync(outputDir, { recursive: true });

writeCsv("cua-hang.csv", [
  "code", "name", "kind", "address", "district", "lat", "lng", "hours", "services", "distance_km", "owner_phone", "capacity_per_hour",
], stores.value.map((store) => {
  const [lat = "", lng = ""] = String(store.coordinates || "").split(",").map((part) => part.trim());
  return [
    storeCode(store.id), store.name, normalizedKind(store.kind), store.address, districtFromAddress(store.address), lat, lng,
    store.hours, (store.services || []).join("|"), store.distance, "", "",
  ];
}));

writeCsv("thuc-don.csv", [
  "sku", "name", "category", "base_price", "description", "note", "ingredients", "allergens", "origin", "serving", "prep", "calories", "reward_points", "sweetness", "tags",
], products.value.map((product) => {
  const canonical = catalogBySku.get(product.id);
  return [
    canonical?.sku || product.id, product.name, canonical?.category || product.category, canonical?.price ?? "", product.description,
    product.note, product.ingredients, product.allergens, product.origin, product.serving, product.prep, product.calories,
    product.rewardPoints, (product.sweetness || []).join("|"), (product.tags || []).join("|"),
  ];
}));

writeCsv("topping.csv", ["product_sku", "option_code", "name", "price_delta"], catalog.value.flatMap((product) =>
  (product.options || []).map((option) => [product.sku, option.code, option.name, option.priceDelta]),
));

const storeChecklist = stores.value.map((store, index) =>
  `${String(index + 1).padStart(2, "0")}. [ ] ${store.name} — ${store.kind} — ${store.address}`,
).join("\n");
const sourceOnlyText = sourceOnlyProducts.length ? sourceOnlyProducts.map((product) => `\`${product.id}\` — ${product.name}`).join(", ") : "Không có";
const catalogOnlyText = catalogOnlyProducts.length ? catalogOnlyProducts.map((product) => `\`${product.sku}\` — ${product.name}${product.testOnly ? " (chỉ kiểm thử)" : ""}`).join(", ") : "Không có";
const unknownKindText = unknownKinds.length ? unknownKinds.map((kind) => `\`${kind}\``).join(", ") : "Không có";
const missingDistrictText = missingDistricts.length ? missingDistricts.map((store) => store.name).join(", ") : "Không có";

const report = `# Báo cáo trích dữ liệu seed

## Kết quả

- Điểm bán: **${stores.value.length}** bản ghi, đọc từ \`${stores.source}\`.
- Địa điểm giao hàng văn phòng: **${deliveryLocations.value.length}** bản ghi, đọc từ \`${deliveryLocations.source}\` (chỉ đối chiếu trong báo cáo vì nhiệm vụ không yêu cầu CSV riêng).
- Món hiển thị cho khách: **${products.value.length}** bản ghi, đọc từ \`${products.source}\`.
- Món trong catalog chuẩn: **${catalog.value.length}** bản ghi, gồm ${catalog.value.filter((product) => product.testOnly).length} SKU chỉ dùng kiểm thử.
- Topping chuẩn: **${catalog.value.reduce((total, product) => total + (product.options || []).length, 0)}** bản ghi.

Các tệp CSV dùng UTF-8 có BOM để mở trực tiếp bằng Excel mà không mất dấu tiếng Việt.

## Chênh lệch cần chủ hệ thống xác nhận

Mã nguồn hiện có **${stores.value.length} điểm bán**, trong khi chủ hệ thống cho biết chuỗi có **23 cửa hàng**. Vui lòng đánh dấu các điểm còn hoạt động trong danh sách đầy đủ dưới đây; không nên nạp vào cơ sở dữ liệu chính thức trước khi chốt danh sách.

${storeChecklist}

Đối chiếu thực đơn:

- Có trong giao diện nhưng không có trong \`BOOTSTRAP_CATALOG\`: ${sourceOnlyText}.
- Có trong \`BOOTSTRAP_CATALOG\` nhưng không có trong giao diện: ${catalogOnlyText}.
- Loại điểm bán chưa ánh xạ được: ${unknownKindText}.
- Điểm bán không suy ra được quận/huyện từ chính chuỗi địa chỉ: ${missingDistrictText}.

## Dữ liệu còn thiếu

- \`owner_phone\` và \`capacity_per_hour\` không có trong mã nguồn, nên được để trống trong \`cua-hang.csv\` để chủ hệ thống điền sau.
- **KHÔNG tìm thấy dữ liệu công thức/định mức nguyên liệu ở bất kỳ đâu trong dự án.** Trường \`ingredients\` chỉ là câu văn liệt kê thành phần, không có khối lượng. Module M7 cần bếp cung cấp định mức có số lượng và đơn vị.
- Cột quận/huyện chỉ được trích khi tên quận/huyện xuất hiện nguyên văn trong địa chỉ; script không tự bịa hoặc tra cứu bên ngoài.
`;

fs.writeFileSync(path.join(outputDir, "BAO-CAO.md"), report, "utf8");

console.log(`Đã xuất ${stores.value.length} điểm bán, ${products.value.length} món và ${catalog.value.reduce((total, product) => total + (product.options || []).length, 0)} topping vào ${path.relative(root, outputDir)}.`);
