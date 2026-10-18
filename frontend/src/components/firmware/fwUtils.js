export const CAT_LABEL = { FANCOIL: "Fancoil", ILUMINACAO: "Iluminação", CAG: "CAG", HIDRAULICA: "Hidráulica", OUTRO: "Outro" };

export const rssiColor = (r) => (r == null ? "text-muted-foreground" : r > -67 ? "text-emerald-400" : r >= -80 ? "text-amber-400" : "text-red-400");

export const fmtUptime = (m) => {
  if (m == null) return "—";
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
};

export const fmtDate = (s) => (s ? new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

const SIG_RE = /NXFW\|TIPO=([^|\0]{1,32})\|MODELO=([^|\0]{1,32})\|VERSAO=([^|\0]{1,16})\|/;

// Lê o .bin no navegador: valida 0xE9 e extrai a assinatura NXFW (se houver)
export async function inspectFirmwareFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder("latin1").decode(buf);
  const m = text.match(SIG_RE);
  return {
    esp32: buf[0] === 0xe9,
    tamanho: buf.length,
    assinatura: m ? { tipo: m[1].trim().toUpperCase(), modelo: m[2].trim().toUpperCase(), versao: m[3].trim() } : null,
  };
}

export const cmpVer = (a, b) => {
  const pa = String(a || "0").split(".").map(Number), pb = String(b || "0").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

export const otaStyle = {
  fila: "text-muted-foreground", enviado: "text-sky-400", ok: "text-emerald-400", erro: "text-red-400", timeout: "text-red-400",
};

export function otaLabel(item, otaState) {
  const ota = otaState || "";
  if (item?.status === "enviado") {
    if (/^baixando/i.test(ota)) return "baixando…";
    if (/reiniciando/i.test(ota)) return "reiniciando…";
    return "enviado, aguardando…";
  }
  if (item?.status === "ok") return "ok";
  if (item?.status === "timeout") return "erro: timeout 10 min";
  if (item?.status === "erro") return /rollback/i.test(item.msg || "") ? "rollback" : item.msg || "erro";
  if (item?.status === "fila") return "na fila";
  return ota || "—";
}
