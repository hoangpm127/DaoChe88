import { GlassWater, IceCreamBowl, type LucideIcon, UsersRound } from "lucide-react";

export type Product = {
  id: string;
  name: string;
  legacy: string;
  price: number;
  category: "Chè" | "Đồ uống" | "Combo văn phòng";
  image: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  imageUrl: string;
  note: string;
  description: string;
  popular?: boolean;
  calories: number;
  serving: string;
  prep: string;
  stock: string;
  available: boolean;
  tags: string[];
  ingredients: string;
  allergens: string;
  origin: string;
  sweetness: string[];
  toppings: Array<{ code: string; name: string; price: number }>;
  nutrition: { protein: string; carbs: string; fat: string };
  rewardPoints: number;
};

export type CatalogApiProduct = {
  sku: string;
  name: string;
  category: string;
  price: number;
  status: "available" | "unavailable";
  availableQuantity: number | null;
  description?: string;
  note?: string;
  ingredients?: string;
  allergens?: string;
  origin?: string;
  nutrition?: Record<string, string | number>;
  tags?: string[];
  imageUrl?: string;
  serving?: string;
  prepMinutes?: number;
  rewardPoints?: number;
  sweetness?: string[];
  options?: Array<{ code: string; name: string; priceDelta: number }>;
};

export type ProductFilter = Product["category"] | "Tất cả" | "Bán chạy" | "Giao nhanh" | "Dưới 25k" | "Nhẹ bụng" | "Thuần chay" | "25k–40k" | "Combo tiết kiệm";

function fallbackImage(sku: string): Product["image"] {
  let hash = 0;
  for (const character of sku) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (hash % 8) as Product["image"];
}

function nutritionText(nutrition: Record<string, string | number> | undefined, key: string) {
  const value = nutrition?.[key];
  return value === undefined ? "Chưa cập nhật" : String(value);
}

/** Chuyển DTO catalog từ server thành view-model. Không có món hay giá nào nằm trong bundle frontend. */
export function productFromCatalog(product: CatalogApiProduct): Product | null {
  if (!["Chè", "Đồ uống", "Combo văn phòng"].includes(product.category)) return null;
  const tags = Array.isArray(product.tags) ? product.tags : [];
  const prepMinutes = Number(product.prepMinutes || 0);
  const available = product.status === "available";
  return {
    id: product.sku,
    name: product.name,
    legacy: product.sku,
    price: Number(product.price),
    category: product.category as Product["category"],
    image: fallbackImage(product.sku),
    imageUrl: product.imageUrl || "",
    note: product.note || product.description || "Thông tin món đang được cập nhật.",
    description: product.description || "Thông tin món đang được cập nhật.",
    popular: tags.some((tag) => /bán chạy|best seller/i.test(tag)),
    calories: Number(product.nutrition?.calories || 0),
    serving: product.serving || "Đang cập nhật",
    prep: prepMinutes ? `${prepMinutes} phút` : "Thời gian theo điểm bán",
    stock: available
      ? product.availableQuantity === null ? "Đang phục vụ" : `Còn ${product.availableQuantity} phần`
      : "Tạm hết",
    available,
    tags,
    ingredients: product.ingredients || "Đang cập nhật",
    allergens: product.allergens || "Đang cập nhật",
    origin: product.origin || "Đang cập nhật",
    sweetness: product.sweetness?.length ? product.sweetness : ["50%"],
    toppings: (product.options || []).map((option) => ({ code: option.code, name: option.name, price: Number(option.priceDelta) })),
    nutrition: {
      protein: nutritionText(product.nutrition, "protein"),
      carbs: nutritionText(product.nutrition, "carbs"),
      fat: nutritionText(product.nutrition, "fat"),
    },
    rewardPoints: Number(product.rewardPoints || 0),
  };
}

export const categories: Array<{ label: Product["category"]; icon: LucideIcon }> = [
  { label: "Chè", icon: IceCreamBowl },
  { label: "Đồ uống", icon: GlassWater },
  { label: "Combo văn phòng", icon: UsersRound },
];

export const catalogFilters: ProductFilter[] = [
  "Tất cả",
  ...categories.map((item) => item.label),
  "Bán chạy",
  "Giao nhanh",
  "Dưới 25k",
  "Nhẹ bụng",
  "Thuần chay",
];
