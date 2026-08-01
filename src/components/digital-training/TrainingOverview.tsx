import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  PackageCheck,
  UsersRound,
} from "lucide-react";

type OverviewSession = {
  id: number;
  title: string;
  date: string | null;
  start_time?: string | null;
  end_time?: string | null;
  partner?: string;
  partner_name?: string;
  staff_name?: string;
  status: "unscheduled" | "planned" | "completed" | "cancelled";
};

type OverviewMeeting = {
  id: number;
  title: string;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  representative?: string;
  staff_name?: string;
  status: "unscheduled" | "planned" | "completed" | "cancelled";
};

type OverviewPartner = { id: number; name: string };

type Product = { id: number; name: string; active: boolean };
type Subscription = {
  id: number;
  partner: number;
  partner_name: string;
  product_name: string;
  quantity: number;
  effective_status: "active" | "expiring" | "expired" | "paused" | "cancelled";
  days_remaining?: number | null;
};

type AlertRow = {
  key: string;
  level: "danger" | "warning" | "info";
  title: string;
  detail: string;
};

const dateLabel = (value?: string | null) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString("vi-VN") : "Chưa xếp ngày";
const timeLabel = (start?: string | null, end?: string | null) =>
  [start?.slice(0, 5), end?.slice(0, 5)].filter(Boolean).join(" – ") || "Chưa xếp giờ";
const localDateKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

export default function TrainingOverview({
  sessions,
  meetings,
  partners,
  idToken,
  onOpenCalendar,
  onOpenPartners,
  onOpenProducts,
}: {
  sessions: OverviewSession[];
  meetings: OverviewMeeting[];
  partners: OverviewPartner[];
  idToken: string;
  onOpenCalendar: () => void;
  onOpenPartners: () => void;
  onOpenProducts: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const headers = idToken ? { Authorization: `Bearer ${idToken}` } : undefined;
    setLoading(true);
    Promise.all([
      fetch("/api/digital-training/products", { headers }),
      fetch("/api/digital-training/product-subscriptions", { headers }),
    ])
      .then(async ([productResponse, subscriptionResponse]) => {
        if (!productResponse.ok || !subscriptionResponse.ok)
          throw new Error("Không thể tải tình trạng sản phẩm.");
        const [productRows, subscriptionRows] = await Promise.all([
          productResponse.json(),
          subscriptionResponse.json(),
        ]);
        if (!active) return;
        setProducts(productRows);
        setSubscriptions(subscriptionRows);
        setError("");
      })
      .catch((reason) => {
        if (active) setError(String(reason?.message || reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [idToken]);

  const today = localDateKey(new Date());
  const upcoming = useMemo(
    () =>
      [
        ...sessions.map((item) => ({
          ...item,
          key: `training-${item.id}`,
          kind: "Tập huấn",
          customer: item.partner_name || item.partner || "Chưa gắn khách hàng",
        })),
        ...meetings.map((item) => ({
          ...item,
          key: `meeting-${item.id}`,
          kind: "Lịch công tác",
          customer: item.representative || "Chưa cập nhật đầu mối",
        })),
      ]
        .filter((item) => item.date && item.date >= today && item.status === "planned")
        .sort(
          (a, b) =>
            String(a.date).localeCompare(String(b.date)) ||
            String(a.start_time || "").localeCompare(String(b.start_time || "")),
        ),
    [sessions, meetings, today],
  );

  const statusCounts = useMemo(
    () =>
      subscriptions.reduce<Record<string, number>>((result, item) => {
        result[item.effective_status] = (result[item.effective_status] || 0) + 1;
        return result;
      }, {}),
    [subscriptions],
  );
  const activeQuantity = subscriptions
    .filter((item) => ["active", "expiring"].includes(item.effective_status))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const alerts = useMemo(() => {
    const rows: AlertRow[] = [];
    subscriptions.forEach((item) => {
      if (item.effective_status === "expired")
        rows.push({
          key: `expired-${item.id}`,
          level: "danger",
          title: `${item.product_name} đã hết hạn`,
          detail: `${item.partner_name}${item.days_remaining != null ? ` · Quá hạn ${Math.abs(item.days_remaining)} ngày` : ""}`,
        });
      else if (item.effective_status === "expiring")
        rows.push({
          key: `expiring-${item.id}`,
          level: "warning",
          title: `${item.product_name} sắp hết hạn`,
          detail: `${item.partner_name}${item.days_remaining != null ? ` · Còn ${item.days_remaining} ngày` : ""}`,
        });
    });
    sessions
      .filter((item) => item.status === "unscheduled" || (!item.date && item.status !== "cancelled" && item.status !== "completed"))
      .forEach((item) =>
        rows.push({
          key: `unscheduled-${item.id}`,
          level: "warning",
          title: "Buổi tập huấn chưa xếp lịch",
          detail: `${item.title} · ${item.partner_name || item.partner || "Chưa gắn khách hàng"}`,
        }),
      );
    upcoming
      .filter((item) => !item.staff_name)
      .forEach((item) =>
        rows.push({
          key: `staff-${item.key}`,
          level: "info",
          title: "Lịch sắp tới chưa phân công nhân sự",
          detail: `${item.title} · ${dateLabel(item.date)}`,
        }),
      );
    const allocatedPartners = new Set(
      subscriptions.filter((item) => item.effective_status !== "cancelled").map((item) => item.partner),
    );
    partners
      .filter((item) => !allocatedPartners.has(item.id))
      .forEach((item) =>
        rows.push({
          key: `no-product-${item.id}`,
          level: "info",
          title: "Khách hàng chưa được phân bổ sản phẩm",
          detail: item.name,
        }),
      );
    return rows;
  }, [subscriptions, sessions, upcoming, partners]);

  const cards = [
    { label: "Lịch sắp tới", value: upcoming.length, icon: CalendarClock, tone: "text-blue-700 bg-blue-50", action: onOpenCalendar },
    { label: "Tổng khách hàng", value: partners.length, icon: UsersRound, tone: "text-violet-700 bg-violet-50", action: onOpenPartners },
    { label: "Số lượng sản phẩm đang dùng", value: activeQuantity, icon: PackageCheck, tone: "text-emerald-700 bg-emerald-50", action: onOpenProducts },
    { label: "Cảnh báo cần xử lý", value: alerts.length, icon: AlertTriangle, tone: "text-amber-700 bg-amber-50", action: undefined },
  ];

  return (
    <section className="mt-1 space-y-5">
      <header className="rounded-2xl border bg-white p-6 shadow-sm">
        <p className="text-xs font-extrabold uppercase tracking-wider text-blue-600">Điều hành Đào tạo số</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-950">Tổng quan</h1>
        <p className="mt-2 text-sm text-slate-500">Theo dõi lịch sắp tới, khách hàng, mức sử dụng sản phẩm và các việc cần xử lý.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, tone, action }) => (
          <button key={label} type="button" onClick={action} className="rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:hover:translate-y-0">
            <span className={`inline-flex rounded-xl p-2.5 ${tone}`}><Icon className="h-5 w-5" /></span>
            <b className="mt-4 block text-3xl text-slate-950">{value}</b>
            <span className="mt-1 block text-sm font-semibold text-slate-500">{label}</span>
          </button>
        ))}
      </div>

      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,1fr)]">
        <article className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b p-5">
            <div><h2 className="font-extrabold">Lịch sắp tới</h2><p className="mt-1 text-xs text-slate-500">Các lịch đã lên kế hoạch, sắp xếp theo thời gian.</p></div>
            <button onClick={onOpenCalendar} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700">Xem lịch <ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="divide-y">
            {upcoming.slice(0, 7).map((item) => (
              <button key={item.key} onClick={onOpenCalendar} className="grid w-full gap-2 p-4 text-left hover:bg-slate-50 sm:grid-cols-[7rem_minmax(0,1fr)_10rem] sm:items-center">
                <div><b className="block text-sm text-blue-700">{dateLabel(item.date)}</b><span className="text-xs text-slate-500">{timeLabel(item.start_time, item.end_time)}</span></div>
                <div><b className="block text-sm text-slate-950">{item.title}</b><span className="mt-1 block text-xs text-slate-500">{item.kind} · {item.customer}</span></div>
                <span className={`text-xs font-semibold ${item.staff_name ? "text-slate-600" : "text-amber-700"}`}>{item.staff_name || "Chưa phân công"}</span>
              </button>
            ))}
            {!upcoming.length && <p className="p-10 text-center text-sm text-slate-500">Chưa có lịch sắp tới.</p>}
          </div>
        </article>

        <article className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="font-extrabold">Tình trạng sản phẩm</h2><p className="mt-1 text-xs text-slate-500">{products.filter((item) => item.active).length} sản phẩm, dịch vụ đang kinh doanh.</p></div>
            <button onClick={onOpenProducts} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700">Chi tiết <ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {[
              ["Đang sử dụng", statusCounts.active || 0, "bg-emerald-50 text-emerald-700"],
              ["Sắp hết hạn", statusCounts.expiring || 0, "bg-amber-50 text-amber-700"],
              ["Đã hết hạn", statusCounts.expired || 0, "bg-rose-50 text-rose-700"],
              ["Tạm dừng/Đã hủy", (statusCounts.paused || 0) + (statusCounts.cancelled || 0), "bg-slate-100 text-slate-700"],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className={`rounded-xl p-4 ${tone}`}><b className="text-2xl">{value}</b><span className="mt-1 block text-xs font-bold">{label}</span></div>
            ))}
          </div>
          {loading && <p className="mt-4 text-xs text-slate-500">Đang cập nhật dữ liệu sản phẩm...</p>}
        </article>
      </div>

      <article className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-5"><h2 className="font-extrabold">Cảnh báo cần xử lý</h2><p className="mt-1 text-xs text-slate-500">Ưu tiên sản phẩm hết hạn, lịch chưa xếp và lịch chưa phân công.</p></div>
        <div className="grid gap-px bg-slate-200 md:grid-cols-2">
          {alerts.slice(0, 10).map((item) => (
            <div key={item.key} className="bg-white p-4">
              <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-extrabold ${item.level === "danger" ? "bg-rose-50 text-rose-700" : item.level === "warning" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>{item.level === "danger" ? "Khẩn" : item.level === "warning" ? "Cần xử lý" : "Cần kiểm tra"}</span>
              <b className="mt-2 block text-sm text-slate-950">{item.title}</b><span className="mt-1 block text-xs text-slate-500">{item.detail}</span>
            </div>
          ))}
          {!alerts.length && <p className="bg-white p-10 text-center text-sm text-slate-500 md:col-span-2">Không có cảnh báo cần xử lý.</p>}
        </div>
      </article>
    </section>
  );
}