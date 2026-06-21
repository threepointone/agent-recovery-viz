import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { RecoveryLab } from "./components/RecoveryLab";
import "./styles.css";

function ModeToggle() {
  const [mode, setMode] = useState(
    () => localStorage.getItem("theme") || "dark",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [mode]);

  const toggle = useCallback(
    () => setMode((m) => (m === "light" ? "dark" : "light")),
    [],
  );

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="fixed bottom-4 right-4 z-40 w-10 h-10 rounded-full bg-kumo-base border border-kumo-line shadow-lg flex items-center justify-center hover:bg-kumo-elevated transition-colors text-kumo-default"
    >
      {mode === "light" ? (
        <MoonIcon size={16} />
      ) : (
        <SunIcon size={16} />
      )}
    </button>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    <RecoveryLab />
    <ModeToggle />
  </>,
);
