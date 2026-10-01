import React from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { api, API } from "../lib/api";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useAuth } from "../context/AuthContext";
import { Download, FileText } from "lucide-react";

function Th({ children }) {
  return <th className="px-3 py-2 font-mono uppercase text-[10px] tracking-wider text-muted-foreground text-left">{children}</th>;
}

export default function Relatorios() {
  const { user } = useAuth();
  const { data: commands = [] } = useQuery({
    queryKey: ["rep-cmd"],
    queryFn: async () => (await api.get("/reports/commands?days=30")).data,
  });
  const { data: access = [] } = useQuery({
    queryKey: ["rep-access"],
    queryFn: async () => (await api.get("/reports/access-log?days=30")).data,
    enabled: user?.role === "admin",
  });
  const { data: hoursOn = {} } = useQuery({
    queryKey: ["rep-hours"],
    queryFn: async () => (await api.get("/reports/hours-on?days=30")).data,
  });

  const downloadCsv = () => {
    const token = localStorage.getItem("access_token");
    const url = `${API}/reports/commands?days=30&format=csv`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" })
      .then((r) => r.blob())
      .then((b) => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = u; a.download = "log_comandos.csv"; a.click();
        URL.revokeObjectURL(u);
      });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6" data-testid="reports-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tight uppercase flex items-center gap-3">
            <FileText className="w-8 h-8 text-sky-400" /> Relatórios
          </h1>
          <div className="text-muted-foreground text-sm mt-1">Últimos 30 dias</div>
        </div>
      </div>

      <Tabs defaultValue="comandos">
        <TabsList>
          <TabsTrigger value="comandos" data-testid="tab-comandos">Log de Comandos</TabsTrigger>
          <TabsTrigger value="horas" data-testid="tab-horas">Horas Ligado</TabsTrigger>
          {user?.role === "admin" && <TabsTrigger value="acesso" data-testid="tab-acesso">Log de Acesso</TabsTrigger>}
        </TabsList>

        <TabsContent value="comandos">
          <Card>
            <div className="p-4 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">{commands.length} registros</div>
              <Button size="sm" variant="outline" onClick={downloadCsv} data-testid="export-csv-button">
                <Download className="w-4 h-4 mr-2" /> Exportar CSV
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40"><tr><Th>Data/Hora</Th><Th>Fancoil</Th><Th>Tipo</Th><Th>De</Th><Th>Para</Th><Th>Confirmado</Th></tr></thead>
                <tbody>
                  {commands.map((c, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">{new Date(c.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                      <td className="px-3 py-2">{c.fancoil}</td>
                      <td className="px-3 py-2 font-mono">{c.kind}</td>
                      <td className="px-3 py-2 font-mono">{c.previous_value}</td>
                      <td className="px-3 py-2 font-mono">{c.value}</td>
                      <td className="px-3 py-2">{c.confirmed ? "✓" : "—"}</td>
                    </tr>
                  ))}
                  {commands.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Nenhum comando registrado</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="horas">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40"><tr><Th>Fancoil</Th><Th>Horas Ligado (30d)</Th></tr></thead>
                <tbody>
                  {Object.entries(hoursOn).sort().map(([k, v]) => (
                    <tr key={k} className="border-t border-border">
                      <td className="px-3 py-2">{k}</td>
                      <td className="px-3 py-2 font-mono">{v} h</td>
                    </tr>
                  ))}
                  {Object.keys(hoursOn).length === 0 && <tr><td colSpan={2} className="p-6 text-center text-muted-foreground">Sem dados ainda</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {user?.role === "admin" && (
          <TabsContent value="acesso">
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40"><tr><Th>Data/Hora</Th><Th>Usuário</Th><Th>Ação</Th><Th>IP</Th></tr></thead>
                  <tbody>
                    {access.map((a, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs">{new Date(a.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                        <td className="px-3 py-2">{a.email}</td>
                        <td className="px-3 py-2 font-mono">{a.action}</td>
                        <td className="px-3 py-2 font-mono text-xs">{a.ip || "—"}</td>
                      </tr>
                    ))}
                    {access.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">Nenhum acesso registrado</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
