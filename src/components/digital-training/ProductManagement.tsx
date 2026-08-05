import { useEffect, useMemo, useState } from "react";
import { appDialog } from "../AppDialog";
import { matchesSearch } from "../../lib/searchText";
import {
  BarChart3,
  Boxes,
  Clock3,
  PackagePlus,
  Pencil,
  Plus,
  SlidersHorizontal,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";

export type ProductView = "catalog" | "allocation" | "statistics";

export type ProductPartner = {
  id: number;
  name: string;
  contact_person?: string;
  contact_position?: string;
  phone?: string;
  email?: string;
  planned_sessions?: number;
  partner_type?: string;
  partner_subtype?: string;
  province?: string;
  ward?: string;
  notes?: string;
};

type Product = {
  id: number;
  name: string;
  code: string;
  description: string;
  product_type: "product" | "service";
  active: boolean;
  display_order: number;
  customer_count: number;
  active_customer_count: number;
  expired_customer_count: number;
  total_quantity: number;
};

type Subscription = {
  id: number;
  partner: number;
  partner_name: string;
  partner_group: string;
  partner_subtype: string;
  partner_province: string;
  partner_ward: string;
  product: number;
  product_name: string;
  product_code: string;
  quantity: number;
  starts_at?: string | null;
  expires_at?: string | null;
  status: "active" | "paused" | "cancelled";
  effective_status: "active" | "expiring" | "expired" | "paused" | "cancelled";
  days_remaining?: number | null;
  notes: string;
};

const statusNames: Record<string, string> = {
  active: "Đang sử dụng",
  expiring: "Sắp hết hạn",
  expired: "Đã hết hạn",
  paused: "Tạm dừng",
  cancelled: "Đã hủy",
  registered: "Có đăng ký",
  unregistered: "Chưa đăng ký",
};

const statusClass: Record<string, string> = {
  active: "bg-blue-50 text-blue-700",
  expiring: "bg-amber-50 text-amber-700",
  expired: "bg-rose-50 text-rose-700",
  paused: "bg-slate-100 text-slate-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const showDate = (value?: string | null) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString("vi-VN") : "Không giới hạn";

const apiError = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (body.error) return body.error;
  return Object.entries(body)
    .flatMap(([field, value]) => Array.isArray(value) ? value.map((item) => `${field}: ${item}`) : [`${field}: ${value}`])
    .join(" · ") || "Không thể xử lý yêu cầu.";
};

const preferenceIdentity = (token: string) => {
  if (!token) return "anonymous";
  try {
    const encoded = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") || "";
    const padded = encoded + "=".repeat((4 - encoded.length % 4) % 4);
    const payload = JSON.parse(decodeURIComponent(atob(padded).split("").map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`).join("")));
    return String(payload.sub || payload.email || payload.preferred_username || "anonymous");
  } catch { return "anonymous"; }
};

const emptySubscription = () => ({
  id: 0,
  partner: "",
  product: "",
  quantity: "1",
  starts_at: "",
  expires_at: "",
  status: "active",
  notes: "",
});

export default function ProductManagement({
  partners,
  idToken,
  isGuest,
  view,
}: {
  partners: ProductPartner[];
  idToken: string;
  isGuest: boolean;
  view: ProductView;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState({
    query: "",
    product: "",
    group: "",
    subtype: "",
    province: "",
    ward: "",
    usage: "",
  });
  const [subscriptionDraft, setSubscriptionDraft] = useState(emptySubscription);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [savedColumnIds, setSavedColumnIds] = useState<number[] | null>(null);
  const [otherProductsPartnerId, setOtherProductsPartnerId] = useState<number | null>(null);
  const [productDraft, setProductDraft] = useState({ id: 0, name: "", product_type: "product", description: "", active: true, display_order: 0 });
  const auth = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const columnPreferenceKey = useMemo(() => `digital-training.product-columns.${encodeURIComponent(preferenceIdentity(idToken))}`, [idToken]);

  const load = async () => {
    setBusy(true);
    setNotice("");
    try {
      const [productResponse, subscriptionResponse] = await Promise.all([
        fetch("/api/digital-training/products", { headers: auth }),
        fetch("/api/digital-training/product-subscriptions", { headers: auth }),
      ]);
      if (!productResponse.ok) throw new Error(await apiError(productResponse));
      if (!subscriptionResponse.ok) throw new Error(await apiError(subscriptionResponse));
      setProducts(await productResponse.json());
      setSubscriptions(await subscriptionResponse.json());
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); }, [idToken]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(columnPreferenceKey);
      const parsed = stored ? JSON.parse(stored) : null;
      setSavedColumnIds(Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : null);
    } catch { setSavedColumnIds(null); }
  }, [columnPreferenceKey]);

  const productList = [...products].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, "vi"));
  const subscriptionsByCell = useMemo(
    () => new Map(subscriptions.map((item) => [`${item.partner}:${item.product}`, item])),
    [subscriptions],
  );
  const optionValues = (field: keyof ProductPartner) => Array.from(new Set(partners.map((item) => String(item[field] || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "vi"));

  const filteredPartners = useMemo(() => partners.filter((partner) => {
    const partnerSubscriptions = subscriptions.filter((item) => item.partner === partner.id);
    const selectedSubscription = filters.product
      ? partnerSubscriptions.find((item) => String(item.product) === filters.product)
      : undefined;
    const searchable = [partner.name, partner.partner_type, partner.partner_subtype, partner.province, partner.ward, partner.notes]
      .join(" ").toLocaleLowerCase("vi-VN");
    const statusCandidates = filters.product ? (selectedSubscription ? [selectedSubscription] : []) : partnerSubscriptions;
    const usageMatches = !filters.usage
      || (filters.usage === "registered" && statusCandidates.length > 0)
      || (filters.usage === "unregistered" && statusCandidates.length === 0)
      || statusCandidates.some((item) => item.effective_status === filters.usage);
    return matchesSearch(searchable, filters.query)
      && (!filters.group || partner.partner_type === filters.group)
      && (!filters.subtype || partner.partner_subtype === filters.subtype)
      && (!filters.province || partner.province === filters.province)
      && (!filters.ward || partner.ward === filters.ward)
      && (!filters.product || filters.usage === "unregistered" || !!selectedSubscription)
      && usageMatches;
  }), [partners, subscriptions, filters]);

  const candidateProducts = useMemo(
    () => productList.filter((product) => product.active || subscriptions.some((item) => item.product === product.id)),
    [productList, subscriptions],
  );
  const recommendedProductIds = useMemo(() => {
    const partnerIds = new Set(filteredPartners.map((partner) => partner.id));
    const scoreByProduct = new Map<number, number>();
    subscriptions.forEach((item) => {
      if (!partnerIds.has(item.partner) || !["active", "expiring"].includes(item.effective_status)) return;
      scoreByProduct.set(item.product, (scoreByProduct.get(item.product) || 0) + 1);
    });
    const trainingProduct = productList.find((product) => product.code === "tap-huan");
    const trainingCount = filteredPartners.filter((partner) => Number(partner.planned_sessions || 0) > 0).length;
    if (trainingProduct && trainingCount) scoreByProduct.set(trainingProduct.id, trainingCount);
    return productList.filter((product) => scoreByProduct.has(product.id)).sort((left, right) => (scoreByProduct.get(right.id) || 0) - (scoreByProduct.get(left.id) || 0) || left.display_order - right.display_order).map((product) => product.id);
  }, [filteredPartners, productList, subscriptions]);
  const productColumns = useMemo(() => {
    const ids = savedColumnIds === null ? recommendedProductIds.slice(0, 6) : savedColumnIds;
    const selected = new Set(ids);
    return candidateProducts.filter((product) => selected.has(product.id));
  }, [candidateProducts, recommendedProductIds, savedColumnIds]);
  const selectedProductIds = useMemo(() => new Set(productColumns.map((product) => product.id)), [productColumns]);
  const otherProductsByPartner = useMemo(() => new Map(filteredPartners.map((partner) => {
    const items = productList.flatMap((product) => {
      if (selectedProductIds.has(product.id)) return [];
      const subscription = subscriptionsByCell.get(String(partner.id) + ":" + String(product.id));
      const trainingSessions = product.code === "tap-huan" ? Number(partner.planned_sessions || 0) : 0;
      return subscription || trainingSessions > 0 ? [{ product, subscription, trainingSessions }] : [];
    });
    return [partner.id, items];
  })), [filteredPartners, productList, selectedProductIds, subscriptionsByCell]);
  const otherProductsPartner = otherProductsPartnerId == null ? undefined : filteredPartners.find((partner) => partner.id === otherProductsPartnerId);
  const persistColumnIds = (ids: number[]) => {
    const unique = Array.from(new Set(ids)).filter((id) => candidateProducts.some((product) => product.id === id));
    setSavedColumnIds(unique);
    window.localStorage.setItem(columnPreferenceKey, JSON.stringify(unique));
  };
  const resetRecommendedColumns = () => {
    setSavedColumnIds(null);
    window.localStorage.removeItem(columnPreferenceKey);
  };

  const visiblePartnerIds = new Set(filteredPartners.map((item) => item.id));
  const visibleSubscriptions = subscriptions.filter((item) =>
    visiblePartnerIds.has(item.partner)
    && (!filters.product || String(item.product) === filters.product)
    && (!filters.usage || ["registered", "unregistered"].includes(filters.usage) || item.effective_status === filters.usage),
  );
  const activeSubscriptions = visibleSubscriptions.filter((item) => ["active", "expiring"].includes(item.effective_status));
  const totalQuantity = activeSubscriptions.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const openSubscription = (partnerId: number, productId: number, item?: Subscription) => {
    setSubscriptionDraft(item ? {
      id: item.id,
      partner: String(item.partner),
      product: String(item.product),
      quantity: String(item.quantity),
      starts_at: item.starts_at || "",
      expires_at: item.expires_at || "",
      status: item.status,
      notes: item.notes || "",
    } : { ...emptySubscription(), partner: String(partnerId), product: String(productId) });
    setSubscriptionOpen(true);
    setNotice("");
  };

  const saveSubscription = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/digital-training/product-subscriptions${subscriptionDraft.id ? `/${subscriptionDraft.id}` : ""}`,
        {
          method: subscriptionDraft.id ? "PATCH" : "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            partner: Number(subscriptionDraft.partner),
            product: Number(subscriptionDraft.product),
            quantity: Number(subscriptionDraft.quantity),
            starts_at: subscriptionDraft.starts_at || null,
            expires_at: subscriptionDraft.expires_at || null,
            status: subscriptionDraft.status,
            notes: subscriptionDraft.notes,
          }),
        },
      );
      if (!response.ok) throw new Error(await apiError(response));
      setSubscriptionOpen(false);
      await load();
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const deleteSubscription = async () => {
    if (!subscriptionDraft.id) return;
    const confirmed = await appDialog.confirm("Xóa đăng ký sản phẩm này?", {
      title: "Xóa đăng ký sản phẩm",
      confirmText: "Xóa đăng ký",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/digital-training/product-subscriptions/${subscriptionDraft.id}`, { method: "DELETE", headers: auth });
      if (!response.ok) throw new Error(await apiError(response));
      setSubscriptionOpen(false);
      await load();
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const openProduct = (item?: Product) => {
    setProductDraft(item ? {
      id: item.id,
      name: item.name,
      product_type: item.product_type,
      description: item.description || "",
      active: item.active,
      display_order: item.display_order,
    } : { id: 0, name: "", product_type: "product", description: "", active: true, display_order: products.length + 1 });
    setNotice("");
    setProductOpen(true);
  };

  const saveProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/digital-training/products${productDraft.id ? `/${productDraft.id}` : ""}`, {
        method: productDraft.id ? "PATCH" : "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: productDraft.name,
          product_type: productDraft.product_type,
          description: productDraft.description,
          active: productDraft.active,
          display_order: Number(productDraft.display_order || 0),
        }),
      });
      if (!response.ok) throw new Error(await apiError(response));
      setProductOpen(false);
      await load();
    } catch (error: any) {
      setNotice(String(error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const productStatistics = productList.map((product) => {
    const rows = visibleSubscriptions.filter((item) => item.product === product.id);
    return {
      product,
      customers: new Set(rows.map((item) => item.partner)).size,
      active: rows.filter((item) => ["active", "expiring"].includes(item.effective_status)).length,
      expiring: rows.filter((item) => item.effective_status === "expiring").length,
      expired: rows.filter((item) => item.effective_status === "expired").length,
      quantity: rows.filter((item) => ["active", "expiring"].includes(item.effective_status)).reduce((sum, item) => sum + item.quantity, 0),
    };
  });
  const groupStatistics = Array.from(new Map(filteredPartners.map((partner) => {
    const key = [partner.partner_type || "Chưa phân nhóm", partner.partner_subtype || "Chưa phân loại"].join(" · ");
    return [key, key];
  })).values()).map((name) => {
    const ids = new Set(filteredPartners.filter((partner) => [partner.partner_type || "Chưa phân nhóm", partner.partner_subtype || "Chưa phân loại"].join(" · ") === name).map((partner) => partner.id));
    const rows = visibleSubscriptions.filter((item) => ids.has(item.partner));
    return { name, customers: ids.size, registered: new Set(rows.map((item) => item.partner)).size, quantity: rows.filter((item) => ["active", "expiring"].includes(item.effective_status)).reduce((sum, item) => sum + item.quantity, 0) };
  }).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "vi"));

  return (
    <section className="mt-1 space-y-5">
      <header className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">{view === "allocation" ? "Khách hàng và sản phẩm đang dùng" : "Danh mục và mức sử dụng"}</p><h1 className="mt-1 text-2xl font-extrabold">{view === "allocation" ? "Khách hàng hiện tại" : "Sản phẩm & dịch vụ"}</h1><p className="mt-2 text-sm text-slate-500">{view === "allocation" ? "Theo dõi đầu mối, số lượng và hạn sử dụng của từng sản phẩm theo khách hàng." : "Quản lý danh mục và theo dõi mức sử dụng sản phẩm, dịch vụ."}</p></div>
          <div className="flex flex-wrap gap-2"><button onClick={() => void load()} className="ft-btn ft-btn-secondary"><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />Làm mới</button>{!isGuest && <button onClick={() => openProduct()} className="ft-primary"><PackagePlus className="h-4 w-4" />Thêm mới</button>}</div>
        </div>

      </header>

      {view !== "catalog" && <div className="grid gap-3 rounded-2xl border bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-7">
        <label className="relative xl:col-span-2"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm" placeholder="Tìm khách hàng, nhóm, địa bàn..." /></label>
        <select value={filters.product} onChange={(event) => setFilters({ ...filters, product: event.target.value })} className="rounded-lg border px-3 py-2 text-sm"><option value="">Tất cả sản phẩm</option>{productList.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={filters.group} onChange={(event) => setFilters({ ...filters, group: event.target.value, subtype: "" })} className="rounded-lg border px-3 py-2 text-sm"><option value="">Tất cả nhóm khách hàng</option>{optionValues("partner_type").map((item) => <option key={item}>{item}</option>)}</select>
        <select value={filters.subtype} onChange={(event) => setFilters({ ...filters, subtype: event.target.value })} className="rounded-lg border px-3 py-2 text-sm"><option value="">Tất cả loại khách hàng</option>{optionValues("partner_subtype").map((item) => <option key={item}>{item}</option>)}</select>
        <select value={filters.province} onChange={(event) => setFilters({ ...filters, province: event.target.value, ward: "" })} className="rounded-lg border px-3 py-2 text-sm"><option value="">Tất cả tỉnh/thành</option>{optionValues("province").map((item) => <option key={item}>{item}</option>)}</select>
        <select value={filters.ward} onChange={(event) => setFilters({ ...filters, ward: event.target.value })} className="rounded-lg border px-3 py-2 text-sm"><option value="">Tất cả xã/phường</option>{optionValues("ward").map((item) => <option key={item}>{item}</option>)}</select>
        <select value={filters.usage} onChange={(event) => setFilters({ ...filters, usage: event.target.value })} className="rounded-lg border px-3 py-2 text-sm xl:col-start-6 xl:col-span-2"><option value="">Tất cả trạng thái sử dụng</option>{["registered", "unregistered", "active", "expiring", "expired", "paused", "cancelled"].map((item) => <option key={item} value={item}>{statusNames[item]}</option>)}</select>
      </div>}

      {notice && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{notice}</p>}

      {view === "catalog" ? <article className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5"><div><h2 className="font-extrabold">Danh mục sản phẩm & dịch vụ</h2><p className="mt-1 text-xs text-slate-500">Quản lý tên, loại, mô tả, thứ tự hiển thị và trạng thái kinh doanh.</p></div>{!isGuest && <button onClick={() => openProduct()} className="ft-primary"><PackagePlus className="h-4 w-4" />Thêm mới</button>}</div>
        <div className="overflow-x-auto border-t"><table className="ft-table min-w-[900px]"><thead><tr><th>STT</th><th>Tên sản phẩm / dịch vụ</th><th>Loại</th><th>Mô tả</th><th>Khách hàng</th><th>Tổng số lượng</th><th>Trạng thái</th><th></th></tr></thead><tbody>{[...products].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, "vi")).map((item, index) => <tr key={item.id}><td>{index + 1}</td><td><b>{item.name}</b><span className="block text-xs text-slate-400">{item.code}</span></td><td><span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">{item.product_type === "service" ? "Dịch vụ" : "Sản phẩm"}</span></td><td className="max-w-md whitespace-normal text-sm text-slate-600">{item.description || "—"}</td><td>{item.customer_count}</td><td><b>{item.total_quantity}</b></td><td><span className={`rounded-full px-2 py-1 text-xs font-bold ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{item.active ? "Đang kinh doanh" : "Ngừng kinh doanh"}</span></td><td>{!isGuest && <button type="button" onClick={() => openProduct(item)} className="ft-btn ft-btn-secondary"><Pencil className="h-4 w-4" />Sửa</button>}</td></tr>)}{!products.length && <tr><td colSpan={8} className="py-10 text-center text-slate-500">Chưa có sản phẩm hoặc dịch vụ.</td></tr>}</tbody></table></div>
      </article> : view === "allocation" ? <article className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-extrabold">{"S\u1ea3n ph\u1ea9m \u0111ang s\u1eed d\u1ee5ng theo kh\u00e1ch h\u00e0ng"}</h2><p className="text-xs text-slate-500">{filteredPartners.length} {"kh\u00e1ch h\u00e0ng /"} {activeSubscriptions.length} {"\u0111\u0103ng k\u00fd \u0111ang s\u1eed d\u1ee5ng / t\u1ed5ng s\u1ed1 l\u01b0\u1ee3ng"} {totalQuantity}</p></div><button type="button" onClick={() => setColumnPickerOpen(true)} className="ft-btn ft-btn-secondary"><SlidersHorizontal className="h-4 w-4" />{"Ch\u1ecdn c\u1ed9t s\u1ea3n ph\u1ea9m"} ({productColumns.length})</button></div>
        <div className="overflow-x-auto"><table className="ft-table min-w-[1120px]"><thead><tr><th className="sticky left-0 z-30 w-12 min-w-12 bg-slate-100">STT</th><th className="sticky z-30 min-w-56 bg-slate-100" style={{ left: "3rem" }}>{"T\u00ean kh\u00e1ch h\u00e0ng"}</th><th className="sticky z-30 min-w-52 bg-slate-100" style={{ left: "17rem" }}>{"\u0110\u1ea1i di\u1ec7n"}</th>{productColumns.map((product) => <th key={product.id} className="min-w-48">{product.name}<span className="block text-[10px] font-normal text-slate-400">{product.description}</span></th>)}<th className="min-w-40">{"S\u1ea3n ph\u1ea9m kh\u00e1c"}</th></tr></thead><tbody>{filteredPartners.length ? filteredPartners.map((partner, index) => { const otherItems = otherProductsByPartner.get(partner.id) || []; const area = [partner.ward, partner.province].filter(Boolean).join(" - "); const contact = [partner.contact_person, partner.contact_position].filter(Boolean).join(" - "); return <tr key={partner.id}><td className="sticky left-0 z-10 bg-white">{index + 1}</td><td className="sticky z-10 bg-white" style={{ left: "3rem" }}><b>{partner.name}</b>{area && <span className="block text-xs text-slate-500">{area}</span>}</td><td className="sticky z-10 bg-white text-sm" style={{ left: "17rem" }}>{contact && <b className="block">{contact}</b>}{partner.phone && <span className="block text-xs text-slate-600">{partner.phone}</span>}{partner.email && <span className="block break-all text-xs text-slate-600">{partner.email}</span>}</td>{productColumns.map((product) => { const item = subscriptionsByCell.get(String(partner.id) + ":" + String(product.id)); const trainingSessions = Number(partner.planned_sessions || 0); const hasTrainingSessions = product.code === "tap-huan" && trainingSessions > 0; return <td key={product.id}>{hasTrainingSessions ? <span className="block rounded-xl border border-cyan-200 bg-cyan-50 p-2 text-sm font-bold text-cyan-800">{trainingSessions} {"bu\u1ed5i"}</span> : item ? <button type="button" onClick={() => !isGuest && openSubscription(partner.id, product.id, item)} className="w-full rounded-xl border border-slate-200 p-2 text-left hover:border-blue-300 hover:bg-blue-50"><span className="flex items-center justify-between gap-2"><b className="text-sm">{product.code === "tap-huan" ? String(item.quantity) + " bu\u1ed5i" : "SL: " + String(item.quantity)}</b>{!isGuest && <Pencil className="h-3.5 w-3.5 text-blue-600" />}</span><span className={"mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold " + statusClass[item.effective_status]}>{statusNames[item.effective_status]}</span><span className="mt-1 block text-[11px] text-slate-500">{"H\u1ea1n:"} {showDate(item.expires_at)}</span>{item.days_remaining != null && <span className={"block text-[11px] font-semibold " + (item.days_remaining < 0 ? "text-rose-600" : item.days_remaining <= 30 ? "text-amber-600" : "text-emerald-600")}>{item.days_remaining < 0 ? "Qu\u00e1 h\u1ea1n " + String(Math.abs(item.days_remaining)) + " ng\u00e0y" : "C\u00f2n " + String(item.days_remaining) + " ng\u00e0y"}</span>}</button> : !product.active ? <span className="text-xs font-semibold text-slate-400">{"Ng\u1eebng kinh doanh"}</span> : !isGuest ? <button type="button" onClick={() => openSubscription(partner.id, product.id)} className="w-full rounded-lg border border-dashed px-2 py-3 text-xs font-bold text-slate-400 hover:border-blue-300 hover:text-blue-600"><Plus className="mr-1 inline h-3.5 w-3.5" />{"Ch\u01b0a \u0111\u0103ng k\u00fd"}</button> : <span className="text-xs text-slate-400">{"Ch\u01b0a \u0111\u0103ng k\u00fd"}</span>}</td>; })}<td>{otherItems.length ? <button type="button" onClick={() => setOtherProductsPartnerId(partner.id)} className="w-full rounded-lg border border-dashed border-violet-300 bg-violet-50 px-2 py-3 text-xs font-bold text-violet-700 hover:bg-violet-100">+ {otherItems.length} {"s\u1ea3n ph\u1ea9m kh\u00e1c"}</button> : null}</td></tr>; }) : <tr><td colSpan={4 + productColumns.length} className="py-12 text-center text-slate-500">{"Kh\u00f4ng c\u00f3 kh\u00e1ch h\u00e0ng ph\u00f9 h\u1ee3p b\u1ed9 l\u1ecdc."}</td></tr>}</tbody></table></div>
      </article> : <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><div className="rounded-2xl border bg-white p-5"><Users className="h-5 w-5 text-blue-600" /><b className="mt-3 block text-3xl">{filteredPartners.length}</b><span className="text-sm text-slate-500">Khách hàng</span></div><div className="rounded-2xl border bg-white p-5"><Boxes className="h-5 w-5 text-violet-600" /><b className="mt-3 block text-3xl">{productList.length}</b><span className="text-sm text-slate-500">Sản phẩm</span></div><div className="rounded-2xl border bg-white p-5"><PackagePlus className="h-5 w-5 text-emerald-600" /><b className="mt-3 block text-3xl">{totalQuantity}</b><span className="text-sm text-slate-500">Tổng số lượng đang dùng</span></div><div className="rounded-2xl border bg-white p-5"><Clock3 className="h-5 w-5 text-amber-600" /><b className="mt-3 block text-3xl">{visibleSubscriptions.filter((item) => item.effective_status === "expiring").length}</b><span className="text-sm text-slate-500">Sắp hết hạn</span></div><div className="rounded-2xl border bg-white p-5"><BarChart3 className="h-5 w-5 text-rose-600" /><b className="mt-3 block text-3xl">{visibleSubscriptions.filter((item) => item.effective_status === "expired").length}</b><span className="text-sm text-slate-500">Đã hết hạn</span></div></div>
        <div className="grid gap-5 xl:grid-cols-2"><article className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="p-5"><h2 className="font-extrabold">Thống kê theo sản phẩm</h2></div><div className="overflow-x-auto"><table className="ft-table"><thead><tr><th>Sản phẩm</th><th>Khách hàng</th><th>Đang dùng</th><th>Sắp hết hạn</th><th>Hết hạn</th><th>Số lượng</th></tr></thead><tbody>{productStatistics.map((item) => <tr key={item.product.id}><td><b>{item.product.name}</b></td><td>{item.customers}</td><td className="text-emerald-700">{item.active}</td><td className="text-amber-700">{item.expiring}</td><td className="text-rose-700">{item.expired}</td><td><b>{item.quantity}</b></td></tr>)}</tbody></table></div></article><article className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="p-5"><h2 className="font-extrabold">Thống kê theo nhóm khách hàng</h2></div><div className="overflow-x-auto"><table className="ft-table"><thead><tr><th>Nhóm / loại</th><th>Khách hàng</th><th>Có sản phẩm</th><th>Số lượng đang dùng</th></tr></thead><tbody>{groupStatistics.map((item) => <tr key={item.name}><td><b>{item.name}</b></td><td>{item.customers}</td><td>{item.registered}</td><td><b>{item.quantity}</b></td></tr>)}</tbody></table></div></article></div>
      </div>}

      {columnPickerOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-extrabold">{"Ch\u1ecdn c\u1ed9t s\u1ea3n ph\u1ea9m"}</h2><p className="mt-1 text-sm text-slate-500">{"Ch\u1ec9 c\u1ed9t \u0111\u00e3 ch\u1ecdn m\u1edbi hi\u1ec7n tr\u00ean b\u1ea3ng. L\u1ef1a ch\u1ecdn \u0111\u01b0\u1ee3c ghi nh\u1edb cho t\u00e0i kho\u1ea3n n\u00e0y."}</p></div><button type="button" onClick={() => setColumnPickerOpen(false)}><X className="h-5 w-5" /></button></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => persistColumnIds(candidateProducts.map((product) => product.id))} className="ft-btn ft-btn-secondary">{"Hi\u1ec7n t\u1ea5t c\u1ea3"}</button><button type="button" onClick={resetRecommendedColumns} className="ft-btn ft-btn-secondary">{"Ch\u1ecdn theo \u0111\u1ec1 xu\u1ea5t"}</button></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{candidateProducts.map((product) => { const checked = productColumns.some((item) => item.id === product.id); return <label key={product.id} className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 hover:border-blue-300"><input type="checkbox" checked={checked} onChange={() => { const base = savedColumnIds === null ? productColumns.map((item) => item.id) : savedColumnIds; persistColumnIds(checked ? base.filter((id) => id !== product.id) : [...base, product.id]); }} /><span><b className="block text-sm">{product.name}</b><span className="text-xs text-slate-500">{product.description || "?"}</span></span></label>; })}{!candidateProducts.length && <p className="py-6 text-sm text-slate-500">{"Ch\u01b0a c\u00f3 s\u1ea3n ph\u1ea9m \u0111\u1ec3 ch\u1ecdn."}</p>}</div><div className="mt-6 flex justify-end"><button type="button" onClick={() => setColumnPickerOpen(false)} className="ft-primary">{"\u0110\u00f3ng"}</button></div></div></div>}
      {otherProductsPartner && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><div className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-extrabold">{"S\u1ea3n ph\u1ea9m kh\u00e1c"}</h2><p className="mt-1 text-sm text-slate-500">{otherProductsPartner.name}</p></div><button type="button" onClick={() => setOtherProductsPartnerId(null)}><X className="h-5 w-5" /></button></div><div className="mt-5 space-y-3">{(otherProductsByPartner.get(otherProductsPartner.id) || []).map(({ product, subscription, trainingSessions }) => <div key={product.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><b>{product.name}</b><p className="mt-1 text-xs text-slate-500">{product.description}</p></div>{!isGuest && subscription && <button type="button" onClick={() => openSubscription(otherProductsPartner.id, product.id, subscription)} className="ft-btn ft-btn-secondary"><Pencil className="h-4 w-4" />{"S\u1eeda"}</button>}</div><p className="mt-3 text-sm font-semibold">{trainingSessions > 0 ? String(trainingSessions) + " bu\u1ed5i" : "SL: " + String(subscription?.quantity || 0)}</p>{subscription && <p className="mt-1 text-xs text-slate-500">{"Tr\u1ea1ng th\u00e1i:"} {statusNames[subscription.effective_status]} {"\u00b7 H\u1ea1n:"} {showDate(subscription.expires_at)}</p>}</div>)}</div><div className="mt-6 flex justify-end"><button type="button" onClick={() => setOtherProductsPartnerId(null)} className="ft-primary">{"\u0110\u00f3ng"}</button></div></div></div>}
            {subscriptionOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><form onSubmit={saveSubscription} className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-extrabold">{subscriptionDraft.id ? "Cập nhật đăng ký" : "Đăng ký sản phẩm"}</h2><p className="mt-1 text-sm text-slate-500">Thiết lập số lượng, thời hạn và trạng thái sử dụng.</p></div><button type="button" onClick={() => setSubscriptionOpen(false)}><X className="h-5 w-5" /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label><span className="mb-1 block text-sm font-bold">Khách hàng *</span><select required disabled={!!subscriptionDraft.id} value={subscriptionDraft.partner} onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, partner: event.target.value })} className="ft-input disabled:bg-slate-100"><option value="">Chọn khách hàng</option>{partners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span className="mb-1 block text-sm font-bold">Sản phẩm *</span><select required disabled={!!subscriptionDraft.id} value={subscriptionDraft.product} onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, product: event.target.value })} className="ft-input disabled:bg-slate-100"><option value="">Chọn sản phẩm</option>{productList.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span className="mb-1 block text-sm font-bold">Số lượng *</span><input required type="number" min="1" className="ft-input" value={subscriptionDraft.quantity} onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, quantity: event.target.value })} /></label><label><span className="mb-1 block text-sm font-bold">Trạng thái</span><select className="ft-input" value={subscriptionDraft.status} onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, status: event.target.value })}><option value="active">Đang sử dụng</option><option value="paused">Tạm dừng</option><option value="cancelled">Đã hủy</option></select></label><label><span className="mb-1 block text-sm font-bold">Ngày bắt đầu</span><input type="date" className="ft-input" value={subscriptionDraft.starts_at} onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, starts_at: event.target.value })} /></label><label><span className="mb-1 block text-sm font-bold">Hạn sử dụng</span><input type="date" className="ft-input" value={subscriptionDraft.expires_at} onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, expires_at: event.target.value })} /></label><label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Ghi chú</span><textarea className="ft-input min-h-24" value={subscriptionDraft.notes} onChange={(event) => setSubscriptionDraft({ ...subscriptionDraft, notes: event.target.value })} /></label></div>{notice && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{notice}</p>}<div className="mt-6 flex justify-between gap-3">{subscriptionDraft.id && <button type="button" onClick={() => void deleteSubscription()} className="ft-btn border-rose-200 text-rose-700"><Trash2 className="h-4 w-4" />Xóa đăng ký</button>}<div className="ml-auto flex gap-2"><button type="button" onClick={() => setSubscriptionOpen(false)} className="ft-btn ft-btn-secondary">Hủy</button><button disabled={busy} className="ft-primary">Lưu đăng ký</button></div></div></form></div>}
      {productOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
        <form onSubmit={saveProduct} className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
          <div className="flex items-start justify-between"><div><h2 className="text-xl font-extrabold">{productDraft.id ? "Cập nhật danh mục" : "Thêm sản phẩm hoặc dịch vụ"}</h2><p className="mt-1 text-sm text-slate-500">Thông tin danh mục được dùng chung cho phân bổ và thống kê.</p></div><button type="button" onClick={() => setProductOpen(false)}><X className="h-5 w-5" /></button></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Tên sản phẩm / dịch vụ *</span><input required className="ft-input" value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} /></label>
            <label><span className="mb-1 block text-sm font-bold">Loại *</span><select className="ft-input" value={productDraft.product_type} onChange={(event) => setProductDraft({ ...productDraft, product_type: event.target.value })}><option value="product">Sản phẩm</option><option value="service">Dịch vụ</option></select></label>
            <label><span className="mb-1 block text-sm font-bold">Thứ tự hiển thị</span><input type="number" min="0" className="ft-input" value={productDraft.display_order} onChange={(event) => setProductDraft({ ...productDraft, display_order: Number(event.target.value) })} /></label>
            <label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold">Mô tả</span><textarea className="ft-input min-h-24" value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} /></label>
            <label className="sm:col-span-2 flex items-center gap-2 rounded-xl border bg-slate-50 p-3"><input type="checkbox" checked={productDraft.active} onChange={(event) => setProductDraft({ ...productDraft, active: event.target.checked })} /><span className="text-sm font-bold">Đang kinh doanh và cho phép phân bổ mới</span></label>
          </div>
          {notice && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{notice}</p>}
          <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setProductOpen(false)} className="ft-btn ft-btn-secondary">Hủy</button><button disabled={busy} className="ft-primary">{productDraft.id ? "Lưu thay đổi" : "Thêm mới"}</button></div>
        </form>
      </div>}    </section>
  );
}
