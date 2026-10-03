import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { wsUrl } from "../lib/api";
import { useSound } from "./SoundContext";

const TelemetryContext = createContext(null);
export const useTelemetry = () => useContext(TelemetryContext);

export function TelemetryProvider({ children }) {
  const [states, setStates] = useState({});
  const [alarmsBump, setAlarmsBump] = useState(0);
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
    <TelemetryContext.Provider value={{ states, alarmsBump }}>
      {children}
    </TelemetryContext.Provider>
  );
}
