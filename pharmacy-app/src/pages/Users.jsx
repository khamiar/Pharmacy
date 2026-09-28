import React, { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import Table from "../components/Table";
import Modal from "../components/Modal";
import { useAuth } from "../context/AuthContext";
import {
  catalogRequest as request,
  catalogError,
} from "../services/catalogService";
export default function Users() {
  const { user, logout } = useAuth();
  const [filters, setFilters] = useState({
    search: "",
    status: "",
    role: "",
    page: 1,
    limit: 10,
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState(null);
  const [role, setRole] = useState("staff");
  const [roleError, setRoleError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setResult(null);
    setError("");
    const timer = setTimeout(
      () =>
        request("users", { params: filters, signal: controller.signal })
          .then((data) => {
            if (controller.signal.aborted) return;
            if (filters.page > data.pagination.pages) {
              setFilters((current) => ({
                ...current,
                page: data.pagination.pages,
              }));
              return;
            }
            setResult(data);
          })
          .catch((err) => {
            if (controller.signal.aborted) return;
            if (err.response?.status === 401) logout();
            else setError(catalogError(err));
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          }),
      200,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, refresh, logout]);
  const change = async (account, action, nextRole) => {
    const description =
      action === "role"
        ? `Change ${account.full_name}'s role to ${nextRole}?${nextRole === "admin" ? " Administrators can approve staff and manage all implemented modules." : ""}`
        : `${action[0].toUpperCase() + action.slice(1)} ${account.full_name}'s account?`;
    if (!window.confirm(description)) return;
    setBusy(true);
    setError("");
    setRoleError("");
    setNotice("");
    try {
      await request("users", {
        id: account.id,
        action,
        method: "PATCH",
        data: {
          version: account.version,
          ...(action === "role" ? { role: nextRole } : {}),
        },
      });
      setSelected(null);
      setNotice("Staff access updated successfully.");
      setRefresh((value) => value + 1);
    } catch (err) {
      if (err.response?.status === 401) logout();
      else (action === "role" ? setRoleError : setError)(catalogError(err));
    } finally {
      setBusy(false);
    }
  };
  const columns = [
    {
      key: "full_name",
      label: "Name",
      render: (account) => (
        <>
          {account.full_name}
          {account.id === user.id && (
            <small className="d-block text-secondary">Your account</small>
          )}
        </>
      ),
    },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "role", label: "Role" },
    {
      key: "status",
      label: "Approval",
      render: (account) => (
        <span
          className={`badge ${account.status === "ACTIVE" ? "text-bg-success" : account.status === "PENDING" ? "text-bg-warning" : "text-bg-secondary"}`}
        >
          {account.status}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (account) =>
        account.id === user.id ? (
          <span className="small text-secondary">Managed by another admin</span>
        ) : (
          <div className="d-flex flex-wrap gap-2">
            {["PENDING", "REJECTED"].includes(account.status) && (
              <button
                className="btn btn-sm btn-success"
                disabled={busy}
                aria-label={`Approve ${account.email}`}
                onClick={() => change(account, "approve")}
              >
                Approve
              </button>
            )}
            {account.status === "PENDING" && (
              <button
                className="btn btn-sm btn-outline-danger"
                disabled={busy}
                aria-label={`Reject ${account.email}`}
                onClick={() => change(account, "reject")}
              >
                Reject
              </button>
            )}
            {account.status === "ACTIVE" && (
              <>
                <button
                  className="btn btn-sm btn-outline-success"
                  disabled={busy}
                  aria-label={`Change role for ${account.email}`}
                  onClick={() => {
                    setSelected(account);
                    setRole(account.role);
                    setRoleError("");
                  }}
                >
                  Change role
                </button>
                <button
                  className="btn btn-sm btn-outline-danger"
                  disabled={busy}
                  aria-label={`Suspend ${account.email}`}
                  onClick={() => change(account, "suspend")}
                >
                  Suspend
                </button>
              </>
            )}
            {account.status === "SUSPENDED" && (
              <button
                className="btn btn-sm btn-outline-success"
                disabled={busy}
                aria-label={`Reactivate ${account.email}`}
                onClick={() => change(account, "activate")}
              >
                Reactivate
              </button>
            )}
          </div>
        ),
    },
  ];
  return (
    <>
      <PageHeader
        name="Users / Staff"
        description="Approve staff registrations and choose who can administer the pharmacy."
      />
      <p className="small text-secondary">
        New registrations cannot sign in until approved. Approve an account as
        staff first, then use Change role to appoint an administrator or
        pharmacist.
      </p>
      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
          <button
            className="btn btn-sm btn-outline-danger ms-2"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      )}
      <div className="dashboard-panel p-3 mb-3">
        <div className="row g-3">
          <div className="col-md-6">
            <label htmlFor="staff-search" className="form-label">
              Search staff
            </label>
            <input
              id="staff-search"
              className="form-control"
              type="search"
              maxLength={150}
              placeholder="Name or email"
              value={filters.search}
              onChange={(event) =>
                setFilters({ ...filters, search: event.target.value, page: 1 })
              }
            />
          </div>
          <div className="col-md-3">
            <label htmlFor="staff-status" className="form-label">
              Approval status
            </label>
            <select
              id="staff-status"
              className="form-select"
              value={filters.status}
              onChange={(event) =>
                setFilters({ ...filters, status: event.target.value, page: 1 })
              }
            >
              <option value="">All statuses</option>
              {["PENDING", "ACTIVE", "REJECTED", "SUSPENDED"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <label htmlFor="staff-role" className="form-label">
              Role filter
            </label>
            <select
              id="staff-role"
              className="form-select"
              value={filters.role}
              onChange={(event) =>
                setFilters({ ...filters, role: event.target.value, page: 1 })
              }
            >
              <option value="">All roles</option>
              {["staff", "pharmacist", "admin"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {(loading || result) && (
        <Table
          heading="Staff"
          columns={columns}
          items={result?.items}
          pagination={result?.pagination}
          loading={loading}
          onPage={(page) => setFilters({ ...filters, page })}
        />
      )}
      {selected && (
        <Modal
          title={`Change role: ${selected.full_name}`}
          busy={busy}
          onClose={() => setSelected(null)}
        >
          {roleError && (
            <div className="alert alert-danger" role="alert">
              {roleError}
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              change(selected, "role", role);
            }}
          >
            <label htmlFor="assign-role" className="form-label">
              Role
            </label>
            <select
              id="assign-role"
              className="form-select"
              disabled={busy}
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <option value="staff">Staff</option>
              <option value="pharmacist">Pharmacist</option>
              <option value="admin">Administrator</option>
            </select>
            {role === "admin" && (
              <p className="small text-secondary mt-3">
                Administrators can approve registered staff, appoint other
                admins, and access all implemented modules.
              </p>
            )}
            <div className="d-flex justify-content-end gap-2 mt-3">
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-success"
                disabled={busy || role === selected.role}
              >
                {busy ? "Saving…" : "Save role"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
