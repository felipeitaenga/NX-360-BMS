import React, { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { api, formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card } from "../components/ui/card";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

export default function ResetPassword() {
  const [sp] = useSearchParams();
  const token = sp.get("token") || "";
  const navigate = useNavigate();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    if (p1 !== p2) { setErr("As senhas não coincidem"); return; }
    if (p1.length < 6) { setErr("A senha deve ter ao menos 6 caracteres"); return; }
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: p1 });
      toast.success("Senha redefinida — faça login");
      navigate("/login");
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
          <div className="w-12 h-12 rounded-md bg-amber-500/20 border border-amber-500 flex items-center justify-center">
            <KeyRound className="w-6 h-6 text-amber-400" />
          </div>
          <h1 className="font-display text-lg font-black text-slate-100">Redefinir senha</h1>
        </div>
        {!token ? (
          <div className="text-red-400 text-sm" data-testid="reset-no-token">Link inválido. Solicite novo e-mail.</div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label className="text-slate-300 text-xs uppercase font-mono">Nova senha</Label>
              <Input type="password" value={p1} onChange={(e) => setP1(e.target.value)} required
                     data-testid="reset-password-input" className="mt-1 bg-slate-800 border-slate-700 text-slate-100" />
            </div>
            <div>
              <Label className="text-slate-300 text-xs uppercase font-mono">Confirmar nova senha</Label>
              <Input type="password" value={p2} onChange={(e) => setP2(e.target.value)} required
                     data-testid="reset-password-confirm" className="mt-1 bg-slate-800 border-slate-700 text-slate-100" />
            </div>
            {err && <div className="text-red-400 text-sm" data-testid="reset-error">{err}</div>}
            <Button type="submit" disabled={loading} data-testid="reset-submit-button"
                    className="w-full bg-sky-600 hover:bg-sky-500 text-white uppercase tracking-wide">
              {loading ? "Salvando..." : "Redefinir senha"}
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
