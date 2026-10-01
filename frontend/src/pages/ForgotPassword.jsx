import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card } from "../components/ui/card";
import { Mail } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (e2) {
      setErr(formatApiError(e2));
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 scada-grid-bg"
         style={{ background: "linear-gradient(135deg, hsl(220 40% 7%) 0%, hsl(221 36% 12%) 100%)" }}>
      <Card className="w-full max-w-md p-8 bg-slate-900/80 border-slate-700">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-md bg-sky-500/20 border border-sky-500 flex items-center justify-center">
            <Mail className="w-6 h-6 text-sky-400" />
          </div>
          <div>
            <h1 className="font-display text-lg font-black tracking-tight text-slate-100">Esqueci minha senha</h1>
            <div className="text-xs text-slate-400 font-mono uppercase">Enviaremos um link por e-mail</div>
          </div>
        </div>
        {sent ? (
          <div className="space-y-4">
            <div className="text-slate-200 text-sm bg-emerald-500/10 border border-emerald-500/40 p-3 rounded">
              Se o e-mail estiver cadastrado, enviaremos um link de redefinição em instantes. O link expira em 1 hora.
            </div>
            <Link to="/login" className="block text-center text-sky-400 text-sm hover:underline" data-testid="back-to-login">
              Voltar ao login
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label className="text-slate-300 text-xs uppercase font-mono tracking-wider">E-mail</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                     data-testid="forgot-email-input" className="mt-1 bg-slate-800 border-slate-700 text-slate-100" />
            </div>
            {err && <div className="text-red-400 text-sm" data-testid="forgot-error">{err}</div>}
            <Button type="submit" disabled={loading} data-testid="forgot-submit-button"
                    className="w-full bg-sky-600 hover:bg-sky-500 text-white uppercase tracking-wide">
              {loading ? "Enviando..." : "Enviar link"}
            </Button>
            <Link to="/login" className="block text-center text-sky-400 text-xs hover:underline">
              Voltar ao login
            </Link>
          </form>
        )}
      </Card>
    </div>
  );
}
