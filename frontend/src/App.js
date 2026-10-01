import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { SoundProvider } from "./context/SoundContext";
import { TelemetryProvider } from "./context/TelemetryContext";
import AppShell from "./components/AppShell";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Home from "./pages/Home";
import Fancoils from "./pages/Fancoils";
import FancoilDetail from "./pages/FancoilDetail";
import Alarmes from "./pages/Alarmes";
import Relatorios from "./pages/Relatorios";
import Admin from "./pages/Admin";
import EmBreve from "./pages/EmBreve";
import MapaCalor from "./pages/MapaCalor";
import { Lightbulb, Droplets, Loader2 } from "lucide-react";

function Protected({ children, admin }) {
  const { user, checked } = useAuth();
  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password && window.location.pathname !== "/trocar-senha") return <Navigate to="/trocar-senha" replace />;
  if (admin && user.role !== "admin") return <Navigate to="/" replace />;
  return children;
}

function Shell({ children }) {
  return <AppShell>{children}</AppShell>;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SoundProvider>
          <TelemetryProvider>
            <BrowserRouter>
              <Toaster position="top-right" richColors theme="dark" />
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/esqueci-senha" element={<ForgotPassword />} />
                <Route path="/redefinir-senha" element={<ResetPassword />} />
                <Route path="/trocar-senha" element={<Protected><ChangePassword /></Protected>} />
                <Route path="/" element={<Protected><Shell><Home /></Shell></Protected>} />
                <Route path="/ar-condicionado" element={<Protected><Shell><Fancoils /></Shell></Protected>} />
                <Route path="/ar-condicionado/:id" element={<Protected><Shell><FancoilDetail /></Shell></Protected>} />
                <Route path="/mapa-calor" element={<Protected><Shell><MapaCalor /></Shell></Protected>} />
                <Route path="/alarmes" element={<Protected><Shell><Alarmes /></Shell></Protected>} />
                <Route path="/relatorios" element={<Protected><Shell><Relatorios /></Shell></Protected>} />
                <Route path="/iluminacao" element={<Protected><Shell><EmBreve title="Iluminação" icon={Lightbulb} /></Shell></Protected>} />
                <Route path="/hidraulica" element={<Protected><Shell><EmBreve title="Hidráulica" icon={Droplets} /></Shell></Protected>} />
                <Route path="/admin" element={<Protected admin><Shell><Admin /></Shell></Protected>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </TelemetryProvider>
        </SoundProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
