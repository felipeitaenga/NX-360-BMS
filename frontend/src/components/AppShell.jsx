import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Wind, Lightbulb, Droplets, FileText, Siren, Settings,
  LogOut, Sun, Moon, Menu, X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useTelemetry } from "../context/TelemetryContext";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

const ITEMS = [
  { id: "home", label: "Início", icon: LayoutDashboard, path: "/", module: "home" },
  { id: "fancoils", label: "Ar Condicionado", icon: Wind, path: "/ar-condicionado", module: "ar_condicionado" },
  { id: "lighting", label: "Iluminação", icon: Lightbulb, path: "/iluminacao", module: "iluminacao" },
  { id: "hydraulics", label: "Hidráulica", icon: Droplets, path: "/hidraulica", module: "hidraulica" },
  { id: "reports", label: "Relatórios", icon: FileText, path: "/relatorios", module: "relatorios" },
  { id: "alarms", label: "Alarmes", icon: Siren, path: "/alarmes", module: "alarmes" },
  { id: "admin", label: "Administração", icon: Settings, path: "/admin", module: "admin", adminOnly: true },
];

function moduleAllowed(user, perms, item) {
  if (item.adminOnly) return user.role === "admin";
  if (user.role === "admin") return true;
  if (!perms?.modules?.length) return true; // default to allow if not restricted
  return perms.modules.includes(item.module);
}

export default function AppShell({ children }) {
  const { user, perms, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { alarmsBump } = useTelemetry();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data: activeAlarms = [] } = useQuery({
    queryKey: ["active-alarms", alarmsBump],
    queryFn: async () => (await api.get("/alarms?active_only=true")).data,
    refetchInterval: 15000,
    enabled: !!user,
  });

  const items = ITEMS.filter((i) => moduleAllowed(user, perms, i));

  const Nav = ({ onClick }) => (
    <nav className="flex-1 flex flex-col gap-1 px-3 py-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.id}
            to={item.path}
            onClick={onClick}
            data-testid={`nav-${item.id}`}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-3 rounded-md transition-all ${
                isActive
                  ? "bg-sky-600/20 text-sky-300 border-l-4 border-sky-500 font-semibold"
                  : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border-l-4 border-transparent"
              }`
            }
          >
            <Icon className="w-5 h-5" strokeWidth={1.75} />
            <span className="text-sm">{item.label}</span>
            {item.id === "alarms" && activeAlarms.length > 0 && (
              <span
                data-testid="alarm-badge"
                className="ml-auto bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full pulse-red"
              >
                {activeAlarms.length}
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col w-64 shrink-0 border-r"
        style={{ background: "hsl(var(--sidebar-bg))", borderColor: "hsl(var(--sidebar-border))" }}
      >
        <div className="px-5 py-6 border-b" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          <div className="font-display text-lg font-black tracking-tight text-sky-400">PILARES HVAC</div>
          <div className="text-xs text-slate-400 font-mono uppercase tracking-widest mt-1">
            Supervisório de Fancoils
          </div>
        </div>
        <Nav />
        <div className="p-3 border-t text-xs" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          <div className="px-2 py-2 text-slate-400">
            <div className="font-semibold text-slate-200 truncate">{user?.name}</div>
            <div className="truncate">{user?.email}</div>
            <div className="uppercase tracking-wider text-sky-400 mt-1">{user?.role}</div>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              data-testid="theme-toggle-button"
              onClick={toggle}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md bg-slate-800/60 hover:bg-slate-800 text-slate-200 text-xs"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {theme === "dark" ? "Claro" : "Escuro"}
            </button>
            <button
              data-testid="logout-button"
              onClick={async () => { await logout(); navigate("/login"); }}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md bg-red-900/40 hover:bg-red-900/60 text-red-200 text-xs"
            >
              <LogOut className="w-4 h-4" />
              Sair
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 flex items-center justify-between px-4 py-3 border-b"
           style={{ background: "hsl(var(--sidebar-bg))", borderColor: "hsl(var(--sidebar-border))" }}>
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen(true)} data-testid="menu-open" className="p-2 text-slate-200">
            <Menu className="w-6 h-6" />
          </button>
          <span className="font-display font-black text-sky-400">PILARES HVAC</span>
        </div>
        <div className="flex items-center gap-2">
          {activeAlarms.length > 0 && (
            <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full pulse-red">
              {activeAlarms.length}
            </span>
          )}
          <button onClick={toggle} data-testid="theme-toggle-mobile" className="p-2 text-slate-200">
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="relative w-72 flex flex-col"
                 style={{ background: "hsl(var(--sidebar-bg))" }}>
            <div className="flex items-center justify-between px-5 py-5 border-b" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
              <span className="font-display font-black text-sky-400">PILARES HVAC</span>
              <button onClick={() => setOpen(false)} data-testid="menu-close" className="text-slate-300">
                <X className="w-6 h-6" />
              </button>
            </div>
            <Nav onClick={() => setOpen(false)} />
            <button
              data-testid="logout-mobile"
              onClick={async () => { await logout(); navigate("/login"); }}
              className="m-3 flex items-center justify-center gap-2 py-2 rounded-md bg-red-900/40 text-red-200 text-sm"
            >
              <LogOut className="w-4 h-4" /> Sair
            </button>
          </aside>
        </div>
      )}

      <main className="flex-1 flex flex-col pt-14 lg:pt-0 min-w-0">
        <div className="flex-1 overflow-x-hidden">{children}</div>
      </main>
    </div>
  );
}
