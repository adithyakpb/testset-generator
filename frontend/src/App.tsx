import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useParams } from "react-router-dom";
import { api, demoMode, initApi, type Role } from "./api";
import Dashboard from "./screens/Dashboard";
import Data from "./screens/Data";
import Analysis from "./screens/Analysis";
import Spec from "./screens/Spec";
import Generate from "./screens/Generate";
import Review from "./screens/Review";
import Testsets from "./screens/Testsets";

function ProjectLayout() {
  const { pid = "proj_demo01" } = useParams();
  const base = `/p/${pid}`;
  const links: { to: string; label: string; icon: string; section?: string }[] = [
    { to: `${base}`, label: "Dashboard", icon: "◎" },
    { to: `${base}/data`, label: "Data & Seeds", icon: "⬆", section: "pipeline" },
    { to: `${base}/analysis`, label: "Analysis", icon: "⚗", section: "pipeline" },
    { to: `${base}/spec`, label: "Response Spec", icon: "✎", section: "pipeline" },
    { to: `${base}/generate`, label: "Generate", icon: "⚙", section: "pipeline" },
    { to: `${base}/review`, label: "Review Queue", icon: "✓", section: "pipeline" },
    { to: `${base}/testsets`, label: "Testsets & Export", icon: "📦", section: "pipeline" },
  ];
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">T</span> Testset Generator
        </div>
        <nav>
          {links.map((l) => (
            <div key={l.to}>
              {l.section && l.section === "pipeline" && links.indexOf(l) === 2 && (
                <div className="nav-section">Pipeline</div>
              )}
              <NavLink to={l.to} end={l.to === base} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
                <span>{l.icon}</span> {l.label}
              </NavLink>
            </div>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div style={{ fontWeight: 600 }}>Project: E-commerce Support Bot</div>
          <div className="topbar-right">
            <span className="badge badge-info">role</span>
            <RoleSwitch />
          </div>
        </header>
        {demoMode.value && (
          <div className="banner-demo">
            ⚠ Demo mode — API not connected. Showing built-in mock data so you can explore the full workflow.
          </div>
        )}
        <div className="content">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="data" element={<Data />} />
            <Route path="analysis" element={<Analysis />} />
            <Route path="spec" element={<Spec />} />
            <Route path="generate" element={<Generate />} />
            <Route path="review" element={<Review />} />
            <Route path="testsets" element={<Testsets />} />
            <Route path="*" element={<Navigate to={base} replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function RoleSwitch() {
  const [role, setRole] = useState<Role>(api.role());
  return (
    <select
      value={role}
      style={{ width: "auto" }}
      onChange={(e) => {
        const r = e.target.value as Role;
        api.setRole(r);
        setRole(r);
      }}
      title="Simulated role (demo)"
    >
      <option value="admin">admin</option>
      <option value="user">SME / user</option>
    </select>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    initApi().finally(() => setReady(true));
  }, []);
  if (!ready) return <div style={{ padding: 40, color: "var(--muted)" }}>Connecting to API…</div>;
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/p/proj_demo01" replace />} />
      <Route path="/p/:pid/*" element={<ProjectLayout />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
