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
  const [showAllProductColumns, setShowAllProductColumns] = useState(false);
  const [productDraft, setProductDraft] = useState({ id: 0, name: "", product_type: "product", description: "", active: true, display_order: 0 });
  const auth = idToken ? { Authorization: `Bearer ${idToken}` } : {};

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

  const productList = [...products].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, "vi"));
  const subscriptionsByCell = useMemo(
    () => new Map(subscriptions.map((item) => [`${item.partner}:${item.product}`, item])),
    [subscriptions],
  );
  const productColumns = useMemo(() => {
    const relevant = productList.filter((product) => product.active || subscriptions.some((item) => item.product === product.id));
    return showAllProductColumns ? relevant : relevant.slice(0, 6);
  }, [productList, showAllProductColumns, subscriptions]);
  const hiddenProductColumnCount = Math.max(0, productList.filter((product) => product.active || subscriptions.some((item) => item.product === product.id)).length - productColumns.length);
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-extrabold">Sản phẩm đang sử dụng theo khách hàng</h2><p className="text-xs text-slate-500">{filteredPartners.length} khách hàng / {activeSubscriptions.length} đăng ký đang sử dụng / tổng số lượng {totalQuantity}</p></div><button type="button" onClick={() => setShowAllProductColumns((current) => !current)} className="ft-btn ft-btn-secondary">{showAllProductColumns ? "Thu gọn cột sản phẩm" : hiddenProductColumnCount ? `Hiện thêm ${hiddenProductColumnCount} sản phẩm` : "Đang hiện tất cả sản phẩm"}</button></div>
        <div className="overflow-x-auto"><table className="ft-table min-w-[1200px]"><thead><tr><th>STT</th><th className="min-w-56">Tên khách hàng</th><th className="min-w-52">Đại diện</th>{productColumns.map((product) => <th key={product.id} className="min-w-48">{product.name}<span className="block text-[10px] font-normal text-slate-400">{product.description}</span></th>)}<th className="min-w-64">Ghi chú</th></tr></thead><tbody>{filteredPartners.length ? filteredPartners.map((partner, index) => <tr key={partner.id}><td>{index + 1}</td><td><b>{partner.name}</b><span className="block text-xs text-slate-500">{[partner.ward, partner.province].filter(Boolean).join(" · ") || "Chưa có địa bàn"}</span></td><td className="text-sm"><b className="block">{partner.contact_person || "Chưa cập nhật"}{partner.contact_position ? ` – ${partner.contact_position}` : ""}</b><span className="block text-xs text-slate-600">{partner.phone || "—"}</span><span className="block break-all text-xs text-slate-600">{partner.email || "—"}</span></td>{productColumns.map((product) => { const item = subscriptionsByCell.get(`${partner.id}:${product.id}`); const trainingSessions = Number(partner.planned_sessions || 0); const hasTrainingSessions = product.code === "tap-huan" && trainingSessions > 0; return <td key={product.id}>{hasTrainingSessions ? <span className="block rounded-xl border border-cyan-200 bg-cyan-50 p-2 text-sm font-bold text-cyan-800">{trainingSessions} buổi</span> : item ? <button type="button" onClick={() => !isGuest && openSubscription(partner.id, product.id, item)} className="w-full rounded-xl border border-slate-200 p-2 text-left hover:border-blue-300 hover:bg-blue-50"><span className="flex items-center justify-between gap-2"><b className="text-sm">{product.code === "tap-huan" ? `${item.quantity} buổi` : `SL: ${item.quantity}`}</b>{!isGuest && <Pencil className="h-3.5 w-3.5 text-blue-600" />}</span><span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${statusClass[item.effective_status]}`}>{statusNames[item.effective_status]}</span><span className="mt-1 block text-[11px] text-slate-500">Hạn: {showDate(item.expires_at)}</span>{item.days_remaining != null && <span className={`block text-[11px] font-semibold ${item.days_remaining < 0 ? "text-rose-600" : item.days_remaining <= 30 ? "text-amber-600" : "text-emerald-600"}`}>{item.days_remaining < 0 ? `Quá hạn ${Math.abs(item.days_remaining)} ngày` : `Còn ${item.days_remaining} ngày`}</span>}</button> : !product.active ? <span className="text-xs font-semibold text-slate-400">Ngừng kinh doanh</span> : !isGuest ? <button type="button" onClick={() => openSubscription(partner.id, product.id)} className="w-full rounded-lg border border-dashed px-2 py-3 text-xs font-bold text-slate-400 hover:border-blue-300 hover:text-blue-600"><Plus className="mr-1 inline h-3.5 w-3.5" />Chưa đăng ký</button> : <span className="text-xs text-slate-400">Chưa đăng ký</span>}</td>; })}<td className="max-w-sm whitespace-normal text-xs"><b className="block text-slate-700">{partner.notes || "—"}</b>{subscriptions.filter((item) => item.partner === partner.id && item.notes).map((item) => <span key={item.id} className="mt-1 block text-slate-500">{item.product_name}: {item.notes}</span>)}</td></tr>) : <tr><td colSpan={4 + productColumns.length} className="py-12 text-center text-slate-500">Không có khách hàng phù hợp bộ lọc.</td></tr>}</tbody></table></div>
      </article> : <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><div className="rounded-2xl border bg-white p-5"><Users className="h-5 w-5 text-blue-600" /><b className="mt-3 block text-3xl">{filteredPartners.length}</b><span className="text-sm text-slate-500">Khách hàng</span></div><div className="rounded-2xl border bg-white p-5"><Boxes className="h-5 w-5 text-violet-600" /><b className="mt-3 block text-3xl">{productList.length}</b><span className="text-sm text-slate-500">Sản phẩm</span></div><div className="rounded-2xl border bg-white p-5"><PackagePlus className="h-5 w-5 text-emerald-600" /><b className="mt-3 block text-3xl">{totalQuantity}</b><span className="text-sm text-slate-500">Tổng số lượng đang dùng</span></div><div className="rounded-2xl border bg-white p-5"><Clock3 className="h-5 w-5 text-amber-600" /><b className="mt-3 block text-3xl">{visibleSubscriptions.filter((item) => item.effective_status === "expiring").length}</b><span className="text-sm text-slate-500">Sắp hết hạn</span></div><div className="rounded-2xl border bg-white p-5"><BarChart3 className="h-5 w-5 text-rose-600" /><b className="mt-3 block text-3xl">{visibleSubscriptions.filter((item) => item.effective_status === "expired").length}</b><span className="text-sm text-slate-500">Đã hết hạn</span></div></div>
        <div className="grid gap-5 xl:grid-cols-2"><article className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="p-5"><h2 className="font-extrabold">Thống kê theo sản phẩm</h2></div><div className="overflow-x-auto"><table className="ft-table"><thead><tr><th>Sản phẩm</th><th>Khách hàng</th><th>Đang dùng</th><th>Sắp hết hạn</th><th>Hết hạn</th><th>Số lượng</th></tr></thead><tbody>{productStatistics.map((item) => <tr key={item.product.id}><td><b>{item.product.name}</b></td><td>{item.customers}</td><td className="text-emerald-700">{item.active}</td><td className="text-amber-700">{item.expiring}</td><td className="text-rose-700">{item.expired}</td><td><b>{item.quantity}</b></td></tr>)}</tbody></table></div></article><article className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="p-5"><h2 className="font-extrabold">Thống kê theo nhóm khách hàng</h2></div><div className="overflow-x-auto"><table className="ft-table"><thead><tr><th>Nhóm / loại</th><th>Khách hàng</th><th>Có sản phẩm</th><th>Số lượng đang dùng</th></tr></thead><tbody>{groupStatistics.map((item) => <tr key={item.name}><td><b>{item.name}</b></td><td>{item.customers}</td><td>{item.registered}</td><td><b>{item.quantity}</b></td></tr>)}</tbody></table></div></article></div>
      </div>}

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
