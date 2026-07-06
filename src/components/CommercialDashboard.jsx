import { useEffect, useState } from 'react'
import {
  TrendingUp,
  Award,
  FileText,
  BarChart3
} from "lucide-react";
import Chart from "react-apexcharts";
import LoadingExperience from "./LoadingExperience";

const UI_FONT = "'Space Grotesk', Inter, sans-serif";
const PERIOD_OPTIONS = [
  { value: "7d", label: "Últimos 7 días", days: 7 },
  { value: "15d", label: "Últimos 15 días", days: 15 },
  { value: "30d", label: "Últimos 30 días", days: 30 },
  { value: "all", label: "Historial total", days: null },
];

function truncateLabel(label, max = 18) {
  const s = String(label ?? "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "...";
}

function cleanLabel(value) {
  return String(value || "").trim();
}

function isValidSupplier(value) {
  const s = cleanLabel(value);
  if (!s) return false;
  return s.toUpperCase() !== "LOGOS";
}

function isValidProduct(value) {
  return cleanLabel(value).length > 0;
}

function parseEventDate(row) {
  const raw = row?.timestamp || row?.created_at || row?.createdAt || "";
  const dt = new Date(raw);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function CommercialDashboard({
  commercialCode,
  commercialName,
  onBack,
  hideCommissions = false,
}) {
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [periodFilter, setPeriodFilter] = useState("30d");
  const selectedPeriod =
    PERIOD_OPTIONS.find((p) => p.value === periodFilter) ||
    PERIOD_OPTIONS[PERIOD_OPTIONS.length - 1];

  const loadStats = async (range = periodFilter) => {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/stats?range=${encodeURIComponent(range)}`);
      if (!response.ok) throw new Error("Error al cargar estadísticas");
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(
          "La API /api/stats no devolvió JSON. En local usa `npm run dev:full`. En Vercel crea/activa la función /api/stats.",
        );
      }
      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error("Error loading stats:", err);
      setLoadError(err.message || "Error al cargar estadísticas");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStats(periodFilter);
  }, [periodFilter]);

  if (loadError) {
    return (
      <div className="w-full px-6 md:px-10 py-10">
        <div className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-2xl p-6 shadow-lg">
          <div className="text-sm font-black uppercase tracking-wider text-slate-600 mb-2">
            Mi Dashboard
          </div>
          <div className="text-xl font-black text-slate-900 mb-2">
            No se pudieron cargar las estadísticas
          </div>
          <div className="text-sm text-slate-600 whitespace-pre-wrap">
            {loadError}
          </div>
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => loadStats(periodFilter)}
              className="px-5 py-2.5 text-sm font-black uppercase tracking-wider bg-slate-900 text-white rounded-xl shadow hover:shadow-md transition-shadow"
            >
              Reintentar
            </button>
            <button
              onClick={onBack}
              className="px-5 py-2.5 text-sm font-black uppercase tracking-wider bg-white border-2 border-slate-200 text-slate-700 rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              Volver
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading || !stats) {
    return (
      <LoadingExperience
        title="Cargando tu historial"
        subtitle="Estamos cargando tus comparativas y descargas."
      />
    );
  }

  // Filter by commercial
  const myDownloads =
    stats.downloads?.filter((d) => d.commercial === commercialCode) || [];
  const myComparisons =
    stats.comparisons?.filter((c) => c.commercial === commercialCode) || [];

  // Calculate stats
  const supplierCounts = {};
  const productCounts = {};
  let totalSavings = 0;
  let totalCommission = 0;

  myDownloads.forEach((d) => {
    const supplier = cleanLabel(d.supplier);
    const product = cleanLabel(d.product);
    if (isValidSupplier(supplier)) {
      supplierCounts[supplier] = (supplierCounts[supplier] || 0) + 1;
    }
    if (isValidProduct(product)) {
      productCounts[product] = (productCounts[product] || 0) + 1;
    }
    totalSavings += Math.abs(parseFloat(d.savings) || 0);
    totalCommission += hideCommissions ? 0 : parseFloat(d.commission) || 0;
  });

  const topSuppliers = Object.entries(supplierCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topProducts = Object.entries(productCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const totalSupplierDownloads = Object.values(supplierCounts).reduce((acc, value) => acc + value, 0);
  const today = new Date();
  const todayDownloads = myDownloads.filter((d) => {
    const dt = parseEventDate(d);
    return dt ? isSameDay(dt, today) : false;
  }).length;
  const todayComparisons = myComparisons.filter((c) => {
    const dt = parseEventDate(c);
    return dt ? isSameDay(dt, today) : false;
  }).length;
  const avgSavings = myDownloads.length > 0 ? totalSavings / myDownloads.length : 0;
  const avgCommission = myDownloads.length > 0 ? totalCommission / myDownloads.length : 0;

  // Chart data by selected period.
  const activityWindowDays = selectedPeriod.days || 30;
  const last7Days = [];
  for (let i = activityWindowDays - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short",
    });
    const count = myDownloads.filter((d) => {
      const dDate = parseEventDate(d);
      if (!dDate) return false;
      return dDate.toDateString() === date.toDateString();
    }).length;
    last7Days.push({ date: dateStr, descargas: count });
  }

  const conversionRate = myComparisons.length > 0 ? (myDownloads.length * 100) / myComparisons.length : 0;

  // ApexCharts configs
  const activityChartOptions = {
    chart: {
      type: "line",
      toolbar: { show: false },
      fontFamily: UI_FONT,
      animations: { enabled: true, easing: "easeinout", speed: 800 },
      sparkline: { enabled: false }
    },
    colors: ["#2563eb"],
    stroke: { curve: "smooth", width: 3 },
    dataLabels: { enabled: false },
    markers: { size: 4, strokeWidth: 2, strokeColors: "#fff", hover: { size: 6 } },
    xaxis: {
      categories: last7Days.map((d) => d.date),
      labels: {
        style: { colors: "#94a3b8", fontSize: "11px", fontWeight: 500 },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { style: { colors: "#94a3b8", fontSize: "11px" } },
      min: 0,
      forceNiceScale: true,
    },
    grid: {
      borderColor: "#e2e8f0",
      strokeDashArray: 3,
      padding: { left: 8, right: 8 },
    },
    tooltip: {
      theme: "dark",
      y: { formatter: (v) => `${v} descargas` },
    },
  };

  const activityChartSeries = [
    { name: "Descargas", data: last7Days.map((d) => d.descargas) },
  ];

  const barChartOptions = {
    chart: {
      type: "bar",
      toolbar: { show: false },
      fontFamily: UI_FONT,
      animations: { enabled: true, easing: "easeinout", speed: 800 },
    },
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 6,
        barHeight: "60%",
        distributed: true,
        dataLabels: { position: "right" },
      },
    },
    colors: ["#3358b8"],
    dataLabels: {
      enabled: true,
      textAnchor: "start",
      formatter: (val, opts) => {
        const item = topSuppliers[opts?.dataPointIndex] || ["", 0];
        const pct = totalSupplierDownloads > 0 ? Math.round((item[1] * 100) / totalSupplierDownloads) : 0;
        return `${val} · ${pct}%`;
      },
      offsetX: 5,
      style: { fontSize: "11px", fontWeight: 700, colors: ["#334155"] },
    },
    xaxis: {
      labels: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: { colors: "#475569", fontSize: "12px", fontWeight: 600 },
        formatter: (v) => truncateLabel(v, 16),
      },
    },
    grid: { show: false },
    tooltip: { theme: "dark", y: { formatter: (v) => `${v} descargas` } },
    legend: { show: false }
  };

  const barChartSeries = [
    {
      name: "Descargas",
      data: topSuppliers.map(([name, value]) => ({ x: name, y: value })),
    },
  ];

  const radialSeries = [Number(conversionRate.toFixed(1))];
  const radialOptions = {
    chart: {
      type: "radialBar",
      fontFamily: UI_FONT,
      sparkline: { enabled: true }
    },
    colors: ["#0ea5e9"],
    plotOptions: {
      radialBar: {
        startAngle: -120,
        endAngle: 240,
        hollow: { size: "64%" },
        track: { background: "#dbeafe" },
        dataLabels: {
          name: { show: true, fontSize: "11px", color: "#64748b", offsetY: 20 },
          value: {
            show: true,
            formatter: (v) => `${Number(v).toFixed(1)}%`,
            fontSize: "24px",
            fontWeight: 800,
            color: "#0f172a",
            offsetY: -8
          }
        }
      }
    },
    labels: ["Descarga/Comparativa"]
  };

  const treemapOptions = {
    chart: {
      type: "treemap",
      toolbar: { show: false },
      fontFamily: UI_FONT
    },
    legend: { show: false },
    dataLabels: {
      enabled: true,
      style: { fontSize: "11px", fontWeight: 700 },
      formatter: (text, opts) => {
        const value = opts?.value ?? 0;
        return `${text}\n${value}`;
      }
    },
    colors: ["#38bdf8"],
    plotOptions: {
      treemap: {
        distributed: true,
        enableShades: true,
        shadeIntensity: 0.45
      }
    },
    tooltip: {
      y: { formatter: (v) => `${v} descargas` }
    }
  };
  const treemapSeries = [
    {
      data: topProducts.map(([name, value]) => ({ x: truncateLabel(name, 28), y: value }))
    }
  ];

  return (
    <div className="dashboard-shell w-full px-6 md:px-10 py-8 rounded-3xl">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1 h-8 bg-gradient-to-b from-blue-600 to-purple-600 rounded-full"></div>
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-slate-500">
                  Mi Dashboard
                </div>
                <div className="text-3xl font-bold text-slate-900">
                  {commercialName || "Comercial"}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value)}
              className="dashboard-select"
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => loadStats(periodFilter)}
              className="dashboard-button transition-all"
            >
              Actualizar
            </button>
            <button
              onClick={onBack}
              className="dashboard-button bg-slate-900 text-white border-0 transition-all"
            >
              Volver
            </button>
          </div>
        </div>

        <div className="dashboard-panel mb-6 px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-900/70">
            Nota importante
          </div>
          <div className="mt-1 text-xs text-slate-700">
            Tus estadisticas se basan en{" "}
            <span className="font-bold">descargas</span> desde el comparador. No
            equivalen a contratos firmados.
          </div>
          <div className="mt-2 text-[11px] font-semibold text-blue-900/70">
            Rango activo: {selectedPeriod.label}
          </div>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="dashboard-panel p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Descargas</div>
            <div className="mt-1 text-3xl font-black text-slate-900">{myDownloads.length}</div>
            <div className="mt-1 text-xs text-slate-500">Hoy: {todayDownloads}</div>
          </div>
          <div className="dashboard-panel p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Comparativas</div>
            <div className="mt-1 text-3xl font-black text-slate-900">{myComparisons.length}</div>
            <div className="mt-1 text-xs text-slate-500">Hoy: {todayComparisons}</div>
          </div>
          <div className="dashboard-panel p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Ahorro total</div>
            <div className="mt-1 text-3xl font-black text-slate-900">€{Math.round(totalSavings).toLocaleString("es-ES")}</div>
            <div className="mt-1 text-xs text-slate-500">Media: €{Math.round(avgSavings).toLocaleString("es-ES")}/descarga</div>
          </div>
          {!hideCommissions ? (
            <div className="dashboard-panel p-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Comisiones</div>
              <div className="mt-1 text-3xl font-black text-slate-900">€{Math.round(totalCommission).toLocaleString("es-ES")}</div>
              <div className="mt-1 text-xs text-slate-500">Media: €{Math.round(avgCommission).toLocaleString("es-ES")}/descarga</div>
            </div>
          ) : (
            <div className="dashboard-panel p-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Rendimiento</div>
              <div className="mt-1 text-3xl font-black text-slate-900">{conversionRate.toFixed(1)}%</div>
              <div className="mt-1 text-xs text-slate-500">Tasa descarga/comparativa</div>
            </div>
          )}
        </div>

        {/* BI grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
          <div className="dashboard-panel p-5 lg:col-span-3">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">
                  Conversión
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Ratio de uso del comparador
                </div>
              </div>
              <Award size={20} className="text-slate-500" />
            </div>
            <Chart
              options={radialOptions}
              series={radialSeries}
              type="radialBar"
              height={240}
            />
          </div>

          <div className="dashboard-panel p-5 lg:col-span-9">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">
                  Evolución de descargas
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {selectedPeriod.label} · serie diaria
                </div>
              </div>
              <BarChart3 size={20} className="text-slate-500" />
            </div>
            <Chart
              options={activityChartOptions}
              series={activityChartSeries}
              type="line"
              height={240}
            />
          </div>

          <div className="dashboard-panel p-5 lg:col-span-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">
                  Top comercializadoras
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Descargas y cuota de participación
                </div>
              </div>
              <TrendingUp size={20} className="text-slate-500" />
            </div>
            {topSuppliers.length > 0 ? (
              <Chart
                options={barChartOptions}
                series={barChartSeries}
                type="bar"
                height={230}
              />
            ) : (
              <div className="flex items-center justify-center h-[230px] text-slate-400 text-sm">
                No hay datos de comercializadoras aún
              </div>
            )}
          </div>

          <div className="dashboard-panel p-5 lg:col-span-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">
                  Top productos
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Distribución por descargas
                </div>
              </div>
              <FileText size={20} className="text-slate-500" />
            </div>
            {topProducts.length > 0 ? (
              <Chart
                options={treemapOptions}
                series={treemapSeries}
                type="treemap"
                height={230}
              />
            ) : (
              <div className="flex items-center justify-center h-[230px] text-slate-400 text-sm">
                No hay productos descargados aún
              </div>
            )}
          </div>
        </div>

        {/* Recent History */}
        <div className="dashboard-panel p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">
                Historial Reciente
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Últimas 10 descargas del periodo
              </div>
            </div>
            <FileText size={20} className="text-slate-600" />
          </div>
          <div className="space-y-2">
            {myDownloads.slice(0, 10).map((download, idx) => {
              const date = new Date(download.timestamp);
              const dateStr = date.toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              });
              const timeStr = date.toLocaleTimeString("es-ES", {
                hour: "2-digit",
                minute: "2-digit",
              });
              const savings = Math.abs(parseFloat(download.savings) || 0);
              const commission = hideCommissions
                ? 0
                : parseFloat(download.commission) || 0;

              return (
                <div
                  key={idx}
                  className="flex items-center gap-4 p-4 bg-white/82 rounded-xl border border-sky-100 hover:shadow-md transition-shadow"
                >
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-slate-200 flex items-center justify-center text-slate-700 font-black">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900 text-sm">
                      {download.supplier}
                    </div>
                    <div className="text-xs text-slate-600 truncate">
                      {download.product}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {dateStr} • {timeStr}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-emerald-700 font-black text-sm">
                      €{savings.toFixed(0)} ahorro
                    </div>
                    {!hideCommissions && (
                      <div className="text-amber-700 font-bold text-xs">
                        €{commission.toFixed(0)} comisión
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {myDownloads.length === 0 && (
              <div className="text-center py-12">
                <FileText size={48} className="mx-auto text-slate-300 mb-4" />
                <div className="text-slate-400 text-sm">
                  No hay descargas registradas
                </div>
                <div className="text-slate-500 text-xs mt-1">
                  Haz tu primera descarga desde los resultados de comparativa
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
