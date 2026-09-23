import React, { useEffect, useState } from "react";
import {
  BsCapsule,
  BsExclamationTriangle,
  BsCalendarX,
  BsTruck,
  BsCashStack,
  BsBag,
  BsPeople,
  BsClipboard,
  BsArrowClockwise,
} from "react-icons/bs";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useAuth } from "../context/AuthContext";
import { getDashboard } from "../services/dashboardService";
const cards = [
  ["totalMedicines", "Total Medicines", BsCapsule, "success"],
  [
    "lowStockMedicines",
    "Low Stock Medicines",
    BsExclamationTriangle,
    "warning",
  ],
  ["expiredMedicines", "Expired Medicines", BsCalendarX, "danger"],
  ["totalSuppliers", "Total Suppliers", BsTruck, "primary"],
  ["todaySales", "Today's Sales", BsCashStack, "success"],
  ["todayPurchases", "Today's Purchases", BsBag, "primary"],
  ["totalCustomers", "Total Customers", BsPeople, "success"],
  ["pendingPrescriptions", "Pending Prescriptions", BsClipboard, "warning"],
];
function EmptyState({ status, subject }) {
  return (
    <div className="dashboard-empty">
      <span className="empty-symbol" aria-hidden="true">
        —
      </span>
      <p className="fw-semibold mb-1">
        {status === "restricted"
          ? "Access restricted"
          : status === "not_configured"
            ? "Not available yet"
            : "No records yet"}
      </p>
      <p className="small text-secondary mb-0">
        {status === "restricted"
          ? "Your role does not include this information."
          : status === "not_configured"
            ? `${subject} will appear when the module is connected.`
            : `No ${subject.toLowerCase()} to display.`}
      </p>
    </div>
  );
}
function Panel({ title, children, subtitle }) {
  return (
    <section className="dashboard-panel">
      <div className="panel-heading">
        <h2 className="h6 mb-1">{title}</h2>
        {subtitle && <p className="small text-secondary mb-0">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
function DashboardTable({ section, columns, subject }) {
  return (
    <div className="table-responsive">
      <table className="table dashboard-table">
        <caption className="visually-hidden">{subject}</caption>
        <thead>
          <tr>
            {columns.map(([key, label]) => (
              <th scope="col" key={key}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.status !== "ready" || !section.items.length ? (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState status={section.status} subject={subject} />
              </td>
            </tr>
          ) : (
            section.items.map((row) => (
              <tr key={row.id}>
                {columns.map(([key]) => (
                  <td key={key}>{row[key]}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
export default function Dashboard() {
  const { user, logout } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    getDashboard(controller.signal)
      .then(setData)
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err.response?.status === 401) logout();
        else
          setError(
            err.response?.status === 403
              ? "Your account does not have dashboard access. Contact your administrator."
              : "The dashboard could not be loaded. Please check your connection and try again.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, logout]);
  const money = (value) =>
    new Intl.NumberFormat("en-TZ", {
      style: "currency",
      currency: data.currency,
      maximumFractionDigits: 0,
    }).format(value);
  const date = (value) =>
    new Intl.DateTimeFormat("en-TZ", {
      timeZone: "Africa/Dar_es_Salaam",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  return (
    <>
      <div className="dashboard-heading">
        <PageHeader
          name="Dashboard"
          description={`Karibu, ${user.full_name}. Your pharmacy at a glance.`}
        />
        <button
          className="btn btn-outline-success refresh-button"
          onClick={() => setAttempt(attempt + 1)}
          disabled={loading}
        >
          <BsArrowClockwise className="me-2" />
          Refresh
        </button>
      </div>
      {loading && (
        <div className="dashboard-panel p-4" role="status">
          <span className="spinner-border spinner-border-sm text-success me-2" />
          Loading your dashboard…
        </div>
      )}
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
          <button
            className="btn btn-sm btn-outline-danger ms-3"
            onClick={() => setAttempt(attempt + 1)}
          >
            Retry
          </button>
        </div>
      )}
      {!loading && data && (
        <>
          <div className="dashboard-status">
            <span className="status-dot" />
            Connected to pharmacy backend
            <span className="ms-auto">{date(data.generatedAt)} · EAT</span>
          </div>
          <div className="alert alert-light border small">
            Medicine, stock, supplier and purchase figures come from your records.
            Sales figures will appear when that module is available.
          </div>
          <StatCard
            stats={cards.map(([key, label, Icon, color]) => ({
              label,
              color,
              icon: <Icon />,
              value:
                data.stats[key].value === null
                  ? "—"
                  : key === "todaySales" || key === "todayPurchases"
                    ? money(data.stats[key].value)
                    : data.stats[key].value,
              hint:
                data.stats[key].status === "restricted"
                  ? "Access restricted"
                  : data.stats[key].status === "not_configured"
                    ? "Not available yet"
                    : "Live data",
            }))}
          />
          <div className="dashboard-grid">
            <Panel title="Sales Overview" subtitle="Daily sales · TZS">
              <EmptyState
                status={data.salesOverview.status}
                subject="Sales trends"
              />
            </Panel>
            <Panel
              title="Stock Overview"
              subtitle="Inventory availability and expiry"
            >
              <div className="stock-summary">
                {[
                  ["inStock", "In Stock", "success"],
                  ["lowStock", "Low Stock", "warning"],
                  ["outOfStock", "Out of Stock", "danger"],
                  ["expiringSoon", "Expiring Soon", "warning"],
                ].map(([key, label, color]) => (
                  <div key={key}>
                    <span className={`stock-dot bg-${color}`} />
                    <span>{label}</span>
                    <strong className="ms-auto">
                      {data.stockOverview[key] ?? "—"}
                    </strong>
                  </div>
                ))}
              </div>
              <p className="small text-secondary px-4 pb-3 mb-0">
                {data.stockOverview.status === "restricted"
                  ? "Your role does not include stock viewing."
                  : "Physical stock counts. Expiring soon includes batches within 30 days."}
              </p>
            </Panel>
          </div>
          <div className="mb-4">
            <Panel title="Recent Sales" subtitle="Latest transactions">
              <DashboardTable
                section={data.recentSales}
                subject="Recent sales"
                columns={[
                  ["invoice", "Invoice"],
                  ["customer", "Customer"],
                  ["amount", "Amount"],
                  ["paymentStatus", "Payment Status"],
                  ["date", "Date"],
                  ["staff", "Staff"],
                ]}
              />
            </Panel>
          </div>
          <div className="dashboard-grid">
            <Panel
              title="Low Stock Medicines"
              subtitle="Items that need replenishment"
            >
              <DashboardTable
                section={data.lowStockMedicines}
                subject="Low stock medicines"
                columns={[
                  ["medicine", "Medicine"],
                  ["category", "Category"],
                  ["currentStock", "Current Stock"],
                  ["minimumStock", "Minimum Stock"],
                  ["status", "Status"],
                ]}
              />
            </Panel>
            <Panel
              title="Recent Activities"
              subtitle="Latest account registrations"
            >
              {data.recentActivities.status !== "ready" ||
              !data.recentActivities.items.length ? (
                <EmptyState
                  status={data.recentActivities.status}
                  subject="Recent activities"
                />
              ) : (
                <ul className="activity-list">
                  {data.recentActivities.items.map((item) => (
                    <li key={item.id}>
                      <span className="activity-icon">
                        <BsPeople />
                      </span>
                      <div>
                        <strong>{item.action}</strong>
                        <p className="small text-secondary mb-1">
                          {item.description}
                        </p>
                        <time
                          className="small text-secondary"
                          dateTime={item.occurredAt}
                        >
                          {date(item.occurredAt)}
                        </time>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
