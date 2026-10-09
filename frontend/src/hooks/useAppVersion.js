import { useEffect, useState } from "react";

/**
 * Lê /version.json do public/. Cache-busting com timestamp para pegar
 * a versão nova sem precisar hard-refresh depois de um deploy.
 */
export function useAppVersion() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    const t = Date.now();
    fetch(`/version.json?t=${t}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setInfo(data))
      .catch(() => {});
  }, []);
  return info;
}
