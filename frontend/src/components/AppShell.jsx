import React, { useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Wind, Lightbulb, Droplets, FileText, Siren, Settings,
  LogOut, Sun, Moon, Menu, X, Thermometer, Volume2, VolumeX, ChevronDown, ChevronRight,
  KeyRound, Snowflake, Clock,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useSound } from "../context/SoundContext";
import { useTelemetry } from "../context/TelemetryContext";
import { useAppVersion } from "../hooks/useAppVersion";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

const ITEMS = [
  { id: "home", label: "Início", icon: LayoutDashboard, path: "/", module: "home" },
  {
    id: "fancoils",
    label: "Ar Condicionado",
    icon: Wind,
    path: "/ar-condicionado",
    module: "ar_condicionado",
    children: [
      { id: "fancoils-list", label: "Fancoil", icon: Wind, path: "/ar-condicionado" },
      { id: "heatmap", label: "Mapa de Calor", icon: Thermometer, path: "/mapa-calor" },
      { id: "cag", label: "CAG", icon: Snowflake, path: "/ar-condicionado/cag" },
      { id: "prog-horaria", label: "Programação Horária", icon: Clock, path: "/ar-condicionado/programacao-horaria" },
    ],
  },
  { id: "lighting", label: "Iluminação", icon: Lightbulb, path: "/iluminacao", module: "iluminacao" },
  { id: "hydraulics", label: "Hidráulica", icon: Droplets, path: "/hidraulica", module: "hidraulica" },
  { id: "reports", label: "Relatórios", icon: FileText, path: "/relatorios", module: "relatorios" },
  { id: "alarms", label: "Alarmes", icon: Siren, path: "/alarmes", module: "alarmes" },
  { id: "admin", label: "Configurações", icon: Settings, path: "/admin", module: "admin", adminOnly: true },
];

function moduleAllowed(user, perms, item) {
  if (item.adminOnly) return user?.role === "admin";
  if (user?.role === "admin") return true;
  if (item.module === "home") return true;
  if (perms?.modules?.length) return perms.modules.includes(item.module);
  if (perms?.fancoil_ids?.length) {
    return ["ar_condicionado", "alarmes"].includes(item.module);
  }
  return false;
}

export default function AppShell({ children }) {
  const { user, perms, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { enabled: soundEnabled, toggle: toggleSound } = useSound();
  const { alarmsBump } = useTelemetry();
  const version = useAppVersion();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const { data: activeAlarms = [] } = useQuery({
    queryKey: ["active-alarms", alarmsBump],
    queryFn: async () => (await api.get("/alarms?active_only=true")).data,
    refetchInterval: 15000,
    enabled: !!user,
  });

  const items = ITEMS.filter((i) => moduleAllowed(user, perms, i));

  const isChildActive = (children = []) =>
    children.some((c) => location.pathname === c.path || location.pathname.startsWith(c.path + "/"));

  const [expandedKeys, setExpandedKeys] = useState(() => {
    const map = {};
    ITEMS.forEach((it) => {
      if (it.children && isChildActive(it.children)) map[it.id] = true;
    });
    return map;
  });

  const toggleExpand = (id) => setExpandedKeys((p) => ({ ...p, [id]: !p[id] }));

  const Nav = ({ onClick }) => (
    <nav className="flex-1 flex flex-col gap-1 px-3 py-4 overflow-y-auto">
      {items.map((item) => {
        const Icon = item.icon;
        if (item.children) {
          const anyActive = isChildActive(item.children);
          const expanded = !!expandedKeys[item.id] || anyActive;
          return (
            <div key={item.id} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggleExpand(item.id)}
                data-testid={`nav-${item.id}-toggle`}
                className={`group flex items-center gap-3 px-3 py-3 rounded-md transition-all text-left border-l-4 ${
                  anyActive
                    ? "bg-sky-600/10 text-sky-200 border-sky-500 font-semibold"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border-transparent"
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={1.75} />
                <span className="text-sm flex-1">{item.label}</span>
                {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              {expanded && (
                <div className="ml-3 pl-2 border-l border-slate-700/60 flex flex-col gap-1 mt-1">
                  {item.children.map((c) => {
                    const CIcon = c.icon;
                    return (
                      <NavLink
                        key={c.id}
                        to={c.path}
                        end={c.path === "/ar-condicionado"}
                        onClick={onClick}
                        data-testid={`nav-${c.id}`}
                        className={({ isActive }) =>
                          `flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-all ${
                            isActive
                              ? "bg-sky-600/20 text-sky-200 font-semibold"
                              : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
                          }`
                        }
                      >
                        <CIcon className="w-4 h-4" strokeWidth={1.75} />
                        <span>{c.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }
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

  const changePassword = () => {
    setOpen(false);
    navigate("/trocar-senha");
  };

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col w-64 shrink-0 border-r"
        style={{ background: "hsl(var(--sidebar-bg))", borderColor: "hsl(var(--sidebar-border))" }}
      >
        <div className="px-5 py-6 border-b" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          <div className="font-display text-lg font-black tracking-tight text-sky-400">NX-360 BMS</div>
          <div className="text-xs text-slate-400 font-mono uppercase tracking-widest mt-1">
            Automação Predial
          </div>
        </div>
        <Nav />
        <div className="p-3 border-t text-xs" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          <div className="px-2 py-2 text-slate-400">
            <div className="font-semibold text-slate-200 truncate">{user?.name}</div>
            <div className="truncate">{user?.email}</div>
            <div className="uppercase tracking-wider text-sky-400 mt-1">{user?.role}</div>
          </div>
          <button
            data-testid="change-password-link"
            onClick={changePassword}
            className="w-full flex items-center justify-center gap-2 py-2 mt-1 rounded-md bg-slate-800/60 hover:bg-slate-800 text-slate-200 text-xs"
          >
            <KeyRound className="w-4 h-4" /> Trocar senha
          </button>
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
              data-testid="sound-toggle-button"
              onClick={toggleSound}
              title={soundEnabled ? "Som ligado" : "Som desligado"}
              className={`flex items-center justify-center gap-1 px-3 py-2 rounded-md text-xs ${
                soundEnabled ? "bg-emerald-900/40 text-emerald-200" : "bg-slate-800/60 text-slate-400"
              }`}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
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
          {version && (
            <div
              data-testid="app-version-footer"
              title={version.codename ? `${version.codename} • ${version.build_date}` : version.build_date}
              className="mt-3 pt-2 border-t border-slate-800/80 text-center text-[10px] font-mono text-slate-500 tracking-wider"
            >
              NX-360 BMS v{version.version}
              <span className="hidden xl:inline"> • {version.build_date}</span>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 flex items-center justify-between px-4 py-3 border-b"
           style={{ background: "hsl(var(--sidebar-bg))", borderColor: "hsl(var(--sidebar-border))" }}>
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen(true)} data-testid="menu-open" className="p-2 text-slate-200">
            <Menu className="w-6 h-6" />
          </button>
          <span className="font-display font-black text-sky-400">NX-360 BMS</span>
        </div>
        <div className="flex items-center gap-2">
          {activeAlarms.length > 0 && (
            <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full pulse-red">
              {activeAlarms.length}
            </span>
          )}
          <button onClick={toggleSound} data-testid="sound-toggle-mobile" className="p-2 text-slate-200">
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>
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
              <span className="font-display font-black text-sky-400">NX-360 BMS</span>
              <button onClick={() => setOpen(false)} data-testid="menu-close" className="text-slate-300">
                <X className="w-6 h-6" />
              </button>
            </div>
            <Nav onClick={() => setOpen(false)} />
            <button
              data-testid="change-password-mobile"
              onClick={changePassword}
              className="mx-3 mb-2 flex items-center justify-center gap-2 py-2 rounded-md bg-slate-800/60 text-slate-200 text-sm"
            >
              <KeyRound className="w-4 h-4" /> Trocar senha
            </button>
            <button
              data-testid="logout-mobile"
              onClick={async () => { await logout(); navigate("/login"); }}
              className="m-3 mt-0 flex items-center justify-center gap-2 py-2 rounded-md bg-red-900/40 text-red-200 text-sm"
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
