import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

const SoundContext = createContext(null);
export const useSound = () => useContext(SoundContext);

export function SoundProvider({ children }) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem("alarm_sound") !== "off");
  const ctxRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("alarm_sound", enabled ? "on" : "off");
  }, [enabled]);

  const beep = useCallback((priority = "alta") => {
    if (!enabled) return;
    try {
      if (!ctxRef.current) {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctxRef.current = new AC();
      }
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") ctx.resume();
      const freq = priority === "alta" ? 880 : priority === "media" ? 660 : 440;
      const dur = priority === "alta" ? 0.9 : 0.5;
      const pulses = priority === "alta" ? 3 : 2;
      for (let i = 0; i < pulses; i++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "triangle";
        o.frequency.value = freq;
        g.gain.value = 0;
        o.connect(g);
        g.connect(ctx.destination);
        const t0 = ctx.currentTime + i * (dur + 0.1);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.25, t0 + 0.02);
        g.gain.linearRampToValueAtTime(0, t0 + dur);
        o.start(t0);
        o.stop(t0 + dur + 0.05);
      }
    } catch (e) {
      // Audio context might be blocked by autoplay policy
    }
  }, [enabled]);

  const toggle = () => setEnabled((v) => !v);

  return (
    <SoundContext.Provider value={{ enabled, toggle, beep }}>{children}</SoundContext.Provider>
  );
}
