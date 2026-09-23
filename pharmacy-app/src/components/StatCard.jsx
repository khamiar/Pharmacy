import React from "react";

const StatCard = ({ stats }) => {
  return (
    <>
      {/* Stat Cards */}
      <div className="row g-3 mb-4">
        {stats.map((stat, idx) => (
          <div className="col-12 col-sm-6 col-xl-3" key={idx}>
            <div
              className={`card stat-card h-100 border-start border-4 border-${stat.color}`}
            >
              <div className="card-body d-flex align-items-center justify-content-between p-3">
                <div>
                  <p className="text-muted small mb-3">{stat.label}</p>
                  <p className="h4 mb-2">{stat.value}</p>
                  {stat.hint && <small className="text-secondary">{stat.hint}</small>}
                </div>
                <div className={`fs-2 text-${stat.color}`}>{stat.icon}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

export default StatCard;
