import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { wsUrl } from "../lib/api";
import { useSound } from "./SoundContext";

const TelemetryContext = createContext(null);
export const useTelemetry = () => useContext(TelemetryContext);

export function TelemetryProvider({ children }) {
  const [states, setStates] = useState({});
  const [alarmsBump, setAlarmsBump] = useState(0);
  const [lightingState, setLightingState] = useState({}); // {mqtt_id: {online,rede,ultimo_contato,circuitos:{1..16:{estado,modo,last_input}}}}
  const [pending, setPending] = useState({}); // "{mqtt_id}:{kind}:{circuito}" -> {timeout?: msg}
  const wsRef = useRef(null);
  const { beep } = useSound();
  const beepRef = useRef(beep);
  useEffect(() => { beepRef.current = beep; }, [beep]);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.event === "snapshot") {
            const next = {};
            msg.data.forEach((d) => (next[d.device_id] = d.state));
            setStates((p) => ({ ...p, ...next }));
          } else if (msg.event === "telemetry") {
            setStates((p) => ({ ...p, [msg.data.device_id]: msg.data.state }));
          } else if (msg.event === "alarm_new") {
            setAlarmsBump((n) => n + 1);
            beepRef.current?.(msg.data?.priority || "alta");
          } else if (msg.event === "alarm_cleared" || msg.event === "alarm_ack") {
            setAlarmsBump((n) => n + 1);
          } else if (msg.event === "lighting_telemetry") {
            const { mqtt_id, circuito, estado, modo, last_input, online, rede } = msg.data || {};
            if (!mqtt_id) return;
            setLightingState((prev) => {
              const c = prev[mqtt_id] ? { ...prev[mqtt_id] } : { mqtt_id, online: false, rede: null, ultimo_contato: null, circuitos: {} };
              c.circuitos = { ...(c.circuitos || {}) };
              if (circuito != null) {
                const cur = c.circuitos[circuito] || { estado: null, modo: null, last_input: null };
                c.circuitos[circuito] = {
                  estado: estado !== undefined ? estado : cur.estado,
                  modo: modo !== undefined ? modo : cur.modo,
                  last_input: last_input !== undefined ? last_input : cur.last_input,
                };
              }
              if (online !== undefined) c.online = online;
              if (rede !== undefined) c.rede = rede;
              c.ultimo_contato = new Date().toISOString();
              return { ...prev, [mqtt_id]: c };
            });
          } else if (msg.event === "lighting_pending") {
            const { mqtt_id, circuito, kind } = msg.data || {};
            setPending((p) => ({ ...p, [`${mqtt_id}:${kind}:${circuito}`]: { ts: Date.now() } }));
          } else if (msg.event === "lighting_pending_resolved") {
            const { mqtt_id, circuito, kind } = msg.data || {};
            setPending((p) => {
              const n = { ...p };
              delete n[`${mqtt_id}:${kind}:${circuito}`];
              return n;
            });
          } else if (msg.event === "lighting_pending_timeout") {
            const { mqtt_id, circuito, kind } = msg.data || {};
            setPending((p) => ({ ...p, [`${mqtt_id}:${kind}:${circuito}`]: { ts: Date.now(), timeout: true } }));
            setTimeout(() => {
              setPending((p) => {
                const n = { ...p };
                delete n[`${mqtt_id}:${kind}:${circuito}`];
                return n;
              });
            }, 2500);
          }
        } catch {}
      };
      ws.onclose = () => setTimeout(connect, 3000);
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch {
      setTimeout(connect, 3000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => { try { wsRef.current?.close(); } catch {} };
  }, [connect]);

  return (
    <TelemetryContext.Provider value={{ states, alarmsBump, lightingState, setLightingState, lightingPending: pending }}>
      {children}
    </TelemetryContext.Provider>
  );
}
