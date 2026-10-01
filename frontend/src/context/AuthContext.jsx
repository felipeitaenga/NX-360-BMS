import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "../lib/api";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking
  const [perms, setPerms] = useState({ modules: [], fancoil_ids: [] });
  const [checked, setChecked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get("/auth/me");
      setUser(r.data.user);
      setPerms(r.data.permissions);
    } catch {
      setUser(false);
      setPerms({ modules: [], fancoil_ids: [] });
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (email, password) => {
    try {
      const r = await api.post("/auth/login", { email, password });
      if (r.data.access_token) {
        localStorage.setItem("access_token", r.data.access_token);
      }
      await refresh();
      return { ok: true, must_change_password: r.data.must_change_password };
    } catch (e) {
      return { ok: false, error: formatApiError(e) };
    }
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    localStorage.removeItem("access_token");
    setUser(false);
    setPerms({ modules: [], fancoil_ids: [] });
  };

  const can = (role) => {
    if (!user) return false;
    if (role === "admin") return user.role === "admin";
    if (role === "operator") return ["admin", "operator"].includes(user.role);
    return true;
  };

  return (
    <AuthContext.Provider value={{ user, perms, checked, login, logout, refresh, can }}>
      {children}
    </AuthContext.Provider>
  );
}
