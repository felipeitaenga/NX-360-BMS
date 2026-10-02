import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card } from "../components/ui/card";
import { Wind, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    const r = await login(email, password);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    toast.success("Autenticado com sucesso");
    if (r.must_change_password) navigate("/trocar-senha");
    else navigate("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 scada-grid-bg relative"
         style={{ background: "linear-gradient(135deg, hsl(220 40% 7%) 0%, hsl(221 36% 12%) 100%)" }}>
      <Card className="w-full max-w-md p-8 bg-slate-900/80 border-slate-700 backdrop-blur">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-md bg-sky-500/20 border border-sky-500 flex items-center justify-center">
            <Wind className="w-6 h-6 text-sky-400" />
          </div>
          <div>
            <h1 className="font-display text-xl font-black tracking-tight text-sky-400">NX-360 BMS</h1>
            <div className="text-xs text-slate-400 font-mono uppercase tracking-widest">Sistema de Automação Predial</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email" className="text-slate-300 text-xs uppercase font-mono tracking-wider">
              E-mail
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@empresa.com"
              required
              data-testid="login-email-input"
              className="mt-1 bg-slate-800 border-slate-700 text-slate-100"
            />
          </div>
          <div>
            <Label htmlFor="password" className="text-slate-300 text-xs uppercase font-mono tracking-wider">
              Senha
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="login-password-input"
              className="mt-1 bg-slate-800 border-slate-700 text-slate-100"
            />
          </div>
          {err && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/40 p-3 rounded">
              <AlertCircle className="w-4 h-4" />
              <span data-testid="login-error">{err}</span>
            </div>
          )}
          <Button
            type="submit"
            disabled={loading}
            data-testid="login-submit-button"
            className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold uppercase tracking-wide"
          >
            {loading ? "Entrando..." : "Entrar"}
          </Button>
          <div className="text-center">
            <a href="/esqueci-senha" data-testid="forgot-password-link" className="text-xs text-sky-400 hover:underline">
              Esqueci minha senha
            </a>
          </div>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-800 text-center text-xs text-slate-500 font-mono uppercase tracking-widest">
          Sistema de controle predial
        </div>
      </Card>
    </div>
  );
}
