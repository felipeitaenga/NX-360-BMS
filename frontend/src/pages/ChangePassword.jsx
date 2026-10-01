import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card } from "../components/ui/card";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

export default function ChangePassword() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [np, setNp] = useState("");
  const [np2, setNp2] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    if (np !== np2) { setErr("As senhas não coincidem"); return; }
    if (np.length < 6) { setErr("A senha deve ter ao menos 6 caracteres"); return; }
    setLoading(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: np });
      await refresh();
      toast.success("Senha alterada com sucesso");
      navigate("/");
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
          <div>
            <h1 className="font-display text-lg font-black tracking-tight text-slate-100">Trocar Senha</h1>
            <div className="text-xs text-slate-400 font-mono uppercase">{user?.must_change_password ? "Obrigatório no primeiro login" : "Atualize sua senha"}</div>
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label className="text-slate-300 text-xs uppercase font-mono">Senha atual</Label>
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required
                   data-testid="current-password-input" className="mt-1 bg-slate-800 border-slate-700 text-slate-100" />
          </div>
          <div>
            <Label className="text-slate-300 text-xs uppercase font-mono">Nova senha</Label>
            <Input type="password" value={np} onChange={(e) => setNp(e.target.value)} required
                   data-testid="new-password-input" className="mt-1 bg-slate-800 border-slate-700 text-slate-100" />
          </div>
          <div>
            <Label className="text-slate-300 text-xs uppercase font-mono">Confirmar nova senha</Label>
            <Input type="password" value={np2} onChange={(e) => setNp2(e.target.value)} required
                   data-testid="confirm-password-input" className="mt-1 bg-slate-800 border-slate-700 text-slate-100" />
          </div>
          {err && <div className="text-red-400 text-sm" data-testid="change-password-error">{err}</div>}
          <Button type="submit" disabled={loading} data-testid="change-password-submit"
                  className="w-full bg-sky-600 hover:bg-sky-500 text-white uppercase tracking-wide">
            {loading ? "Salvando..." : "Alterar senha"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
