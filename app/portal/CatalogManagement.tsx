"use client";

import { Archive, ImageUp, PackagePlus, RefreshCw, Save, ShoppingBag } from "lucide-react";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./CatalogManagement.module.css";

type CatalogProduct = {
  sku: string;
  name: string;
  category: string;
  price: number;
  description: string;
  note: string;
  ingredients: string;
  allergens: string;
  origin: string;
  imageUrl: string;
  serving: string;
  prepMinutes: number;
  rewardPoints: number;
  availableQuantity: number | null;
  status: string;
  tags: string[];
  sweetness: string[];
  nutrition: Record<string, string | number>;
  options: Array<{ code: string; name: string; priceDelta: number }>;
};

type Props = {
  sites: Array<{ id: string; name: string }>;
  canManage: boolean;
  canManageStock: boolean;
  runCommand: (command: string, data: Record<string, unknown>, successMessage: string) => Promise<boolean>;
};

const emptyCreate = { sku: "", name: "", category: "Tào phớ", basePrice: "" };

export default function CatalogManagement({ sites, canManage, canManageStock, runCommand }: Props) {
  const [siteId, setSiteId] = useState(sites[0]?.id || "");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [selectedSku, setSelectedSku] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [create, setCreate] = useState(emptyCreate);
  const [edit, setEdit] = useState({ name: "", description: "", note: "", ingredients: "", allergens: "", origin: "", imageUrl: "", serving: "", prepMinutes: "", rewardPoints: "", basePrice: "" });
  const [stock, setStock] = useState({ onHand: "0", reserved: "0", status: "available" });
  const [option, setOption] = useState({ code: "", name: "", priceDelta: "0" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = siteId ? `?siteId=${encodeURIComponent(siteId)}&channel=webapp` : "?channel=webapp";
      const response = await fetch(`/api/catalog${query}`, { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json() as { products?: CatalogProduct[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Không thể tải catalog.");
      setProducts(payload.products || []);
      setSelectedSku((current) => payload.products?.some((product) => product.sku === current) ? current : payload.products?.[0]?.sku || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tải catalog.");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [load]);
  useEffect(() => {
    const product = products.find((item) => item.sku === selectedSku);
    if (!product) return;
    const frame = window.requestAnimationFrame(() => {
      setEdit({
        name: product.name,
        description: product.description || "",
        note: product.note || "",
        ingredients: product.ingredients || "",
        allergens: product.allergens || "",
        origin: product.origin || "",
        imageUrl: product.imageUrl || "",
        serving: product.serving || "",
        prepMinutes: String(product.prepMinutes || 0),
        rewardPoints: String(product.rewardPoints || 0),
        basePrice: String(product.price),
      });
      setStock({ onHand: String(product.availableQuantity || 0), reserved: "0", status: product.status || "available" });
      setOption({ code: `${product.sku}.TOPPING.`, name: "", priceDelta: "0" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [products, selectedSku]);

  const selected = products.find((product) => product.sku === selectedSku);

  const createProduct = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("create");
    const ok = await runCommand("catalog.product.create", { ...create, basePrice: Number(create.basePrice) }, `Đã tạo món ${create.sku}.`);
    setBusy("");
    if (ok) { setCreate(emptyCreate); await load(); }
  };

  const saveProduct = async () => {
    if (!selected) return;
    setBusy("save");
    const contentOk = await runCommand("catalog.product.update", {
      sku: selected.sku,
      name: edit.name,
      description: edit.description,
      note: edit.note,
      ingredients: edit.ingredients,
      allergens: edit.allergens,
      origin: edit.origin,
      imageUrl: edit.imageUrl,
      serving: edit.serving,
      prepMinutes: Number(edit.prepMinutes),
      rewardPoints: Number(edit.rewardPoints),
    }, `Đã cập nhật nội dung ${selected.sku}.`);
    const price = Number(edit.basePrice);
    const priceOk = contentOk && price !== selected.price
      ? await runCommand("catalog.price.set", { sku: selected.sku, scopeType: "base", price, reason: "Cập nhật từ portal catalog" }, `Đã cập nhật giá ${selected.sku}.`)
      : contentOk;
    setBusy("");
    if (priceOk) await load();
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy("upload");
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/catalog/images", { method: "POST", credentials: "same-origin", body: form });
      const payload = await response.json() as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error || "Không thể tải ảnh.");
      setEdit((current) => ({ ...current, imageUrl: payload.url! }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tải ảnh.");
    } finally {
      setBusy("");
      event.target.value = "";
    }
  };

  const saveStock = async () => {
    if (!selected || !siteId) return;
    setBusy("stock");
    const ok = await runCommand("catalog.site-stock.upsert", {
      sku: selected.sku,
      siteId,
      onHand: Number(stock.onHand),
      reserved: Number(stock.reserved),
      trackStock: true,
      status: stock.status,
    }, `Đã cập nhật tồn món ${selected.sku}.`);
    setBusy("");
    if (ok) await load();
  };

  const saveOption = async () => {
    if (!selected) return;
    setBusy("option");
    const ok = await runCommand("catalog.option.upsert", { sku: selected.sku, code: option.code, name: option.name, priceDelta: Number(option.priceDelta) }, `Đã lưu tuỳ chọn ${option.code}.`);
    setBusy("");
    if (ok) { setOption({ code: `${selected.sku}.TOPPING.`, name: "", priceDelta: "0" }); await load(); }
  };

  return (
    <section className={styles.catalogPanel}>
      <div className={styles.heading}>
        <span><ShoppingBag size={22} /></span>
        <div><small>CATALOG · GIÁ · TỒN MÓN</small><h2>Quản trị thực đơn từ database</h2><p>Giá trên đơn được máy chủ chốt theo điểm bán và không đổi hồi tố.</p></div>
        <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={17} /> Làm mới</button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {canManage && <form className={styles.createRow} onSubmit={createProduct}>
        <input required value={create.sku} onChange={(event) => setCreate({ ...create, sku: event.target.value.toUpperCase() })} placeholder="SKU mới" />
        <input required value={create.name} onChange={(event) => setCreate({ ...create, name: event.target.value })} placeholder="Tên món" />
        <select value={create.category} onChange={(event) => setCreate({ ...create, category: event.target.value })}><option>Tào phớ</option><option>Chè</option><option>Đồ uống</option><option>Combo văn phòng</option></select>
        <input required min="0" type="number" value={create.basePrice} onChange={(event) => setCreate({ ...create, basePrice: event.target.value })} placeholder="Giá VND" />
        <button disabled={Boolean(busy)} type="submit"><PackagePlus size={17} /> {busy === "create" ? "Đang tạo…" : "Thêm món"}</button>
      </form>}
      <div className={styles.toolbar}>
        <label>Điểm áp dụng<select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Giá gốc</option>{sites.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label>
        <label>Món<select value={selectedSku} onChange={(event) => setSelectedSku(event.target.value)}>{products.map((product) => <option value={product.sku} key={product.sku}>{product.sku} · {product.name}</option>)}</select></label>
        <span>{loading ? "Đang tải…" : `${products.length} món`}</span>
      </div>
      {selected && <div className={styles.grid}>
        <div className={styles.form}>
          <label>Tên món<input disabled={!canManage} value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} /></label>
          <label>Giá gốc (VND)<input disabled={!canManage} min="0" type="number" value={edit.basePrice} onChange={(event) => setEdit({ ...edit, basePrice: event.target.value })} /></label>
          <label className={styles.wide}>Mô tả<textarea disabled={!canManage} value={edit.description} onChange={(event) => setEdit({ ...edit, description: event.target.value })} /></label>
          <label>Ghi chú ngắn<input disabled={!canManage} value={edit.note} onChange={(event) => setEdit({ ...edit, note: event.target.value })} /></label>
          <label>Khẩu phần<input disabled={!canManage} value={edit.serving} onChange={(event) => setEdit({ ...edit, serving: event.target.value })} /></label>
          <label>Phút chuẩn bị<input disabled={!canManage} type="number" min="0" value={edit.prepMinutes} onChange={(event) => setEdit({ ...edit, prepMinutes: event.target.value })} /></label>
          <label>Điểm thưởng<input disabled={!canManage} type="number" min="0" value={edit.rewardPoints} onChange={(event) => setEdit({ ...edit, rewardPoints: event.target.value })} /></label>
          <label className={styles.wide}>Thành phần<input disabled={!canManage} value={edit.ingredients} onChange={(event) => setEdit({ ...edit, ingredients: event.target.value })} /></label>
          <label>Dị ứng<input disabled={!canManage} value={edit.allergens} onChange={(event) => setEdit({ ...edit, allergens: event.target.value })} /></label>
          <label>Nguồn gốc<input disabled={!canManage} value={edit.origin} onChange={(event) => setEdit({ ...edit, origin: event.target.value })} /></label>
          <label className={styles.wide}>URL ảnh<input disabled={!canManage} value={edit.imageUrl} onChange={(event) => setEdit({ ...edit, imageUrl: event.target.value })} /></label>
          {canManage && <label className={styles.upload}><ImageUp size={17} /> {busy === "upload" ? "Đang tải ảnh…" : "Tải ảnh lên Volume"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadImage} /></label>}
          {edit.imageUrl && <img className={styles.preview} src={edit.imageUrl} alt={`Ảnh ${edit.name}`} />}
          {canManage && <div className={styles.actions}><button type="button" disabled={Boolean(busy)} onClick={() => void saveProduct()}><Save size={17} /> {busy === "save" ? "Đang lưu…" : "Lưu nội dung & giá"}</button><button className={styles.archive} type="button" disabled={Boolean(busy)} onClick={async () => { setBusy("archive"); const ok = await runCommand("catalog.product.archive", { sku: selected.sku }, `Đã lưu trữ ${selected.sku}.`); setBusy(""); if (ok) await load(); }}><Archive size={17} /> Lưu trữ món</button></div>}
        </div>
        <aside>
          {canManageStock && siteId && <div className={styles.box}><strong>Tồn món tại điểm</strong><label>Khả dụng<input type="number" min="0" value={stock.onHand} onChange={(event) => setStock({ ...stock, onHand: event.target.value })} /></label><label>Đã giữ<input type="number" min="0" value={stock.reserved} onChange={(event) => setStock({ ...stock, reserved: event.target.value })} /></label><label>Trạng thái<select value={stock.status} onChange={(event) => setStock({ ...stock, status: event.target.value })}><option value="available">Đang bán</option><option value="unavailable">Tạm hết</option></select></label><button disabled={Boolean(busy)} type="button" onClick={() => void saveStock()}>Lưu tồn món</button></div>}
          {canManage && <div className={styles.box}><strong>Thêm/sửa topping</strong><input value={option.code} onChange={(event) => setOption({ ...option, code: event.target.value.toUpperCase() })} placeholder="Mã option" /><input value={option.name} onChange={(event) => setOption({ ...option, name: event.target.value })} placeholder="Tên topping" /><input type="number" min="0" value={option.priceDelta} onChange={(event) => setOption({ ...option, priceDelta: event.target.value })} placeholder="Giá thêm" /><button disabled={Boolean(busy)} type="button" onClick={() => void saveOption()}>Lưu topping</button><small>{selected.options.map((item) => `${item.name} (+${item.priceDelta.toLocaleString("vi-VN")}đ)`).join(" · ") || "Chưa có topping"}</small></div>}
        </aside>
      </div>}
    </section>
  );
}
