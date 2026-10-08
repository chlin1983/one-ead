import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

const ELEMENTS_KEY = (id) => `one_ead_excalidraw_elements_${id}`;
const APP_STATE_KEY = (id) => `one_ead_excalidraw_appstate_${id}`;
const FILES_KEY = (id) => `one_ead_excalidraw_files_${id}`;

function getFileIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("file") || "default";
}

// Normalize legacy Excalidraw default pastels (#f5faff is the light blue from Excalidraw's default top picks)
function sanitizeBackgroundColor(color) {
  if (!color) return "#ffffff";
  const lower = color.trim().toLowerCase();
  if (
    lower === "#f5faff" ||
    lower === "#f8f9fa" ||
    lower === "#fffce8" ||
    lower === "#fdf8f6"
  ) {
    return "#ffffff";
  }
  return color;
}

// Lightweight fingerprint to check if elements or canvas background actually changed
function getSceneFingerprint(elements, appState) {
  if (!elements || elements.length === 0) {
    return `0_0_${appState?.viewBackgroundColor || ""}`;
  }
  let totalVer = 0;
  for (let i = 0; i < elements.length; i++) {
    totalVer += elements[i].version || 0;
  }
  return `${elements.length}_${totalVer}_${appState?.viewBackgroundColor || ""}`;
}

// Preset color options for canvas background
const PRESET_BG_COLORS = [
  // Row 1: Clean & Light
  { color: "#ffffff", name: "White" },
  { color: "#f8fafc", name: "Slate White" },
  { color: "#f1f5f9", name: "Cool Gray" },
  { color: "#fffbeb", name: "Warm Paper" },
  { color: "#e0f2fe", name: "Sky Blue" },
  { color: "#dcfce7", name: "Mint Green" },
  // Row 2: Tinted & Dark
  { color: "#ffe4e6", name: "Soft Rose" },
  { color: "#f3e8ff", name: "Lavender" },
  { color: "#1e293b", name: "Dark Slate" },
  { color: "#0f172a", name: "Midnight Navy" },
  { color: "#121212", name: "Pure Dark" },
  { color: "#1e3a8a", name: "Blueprint Blue" },
];

function CanvasBackgroundColorPicker({ currentBgColor, onSelectColor }) {
  const activeColor = sanitizeBackgroundColor(currentBgColor);
  const [hexInput, setHexInput] = useState(activeColor);

  useEffect(() => {
    setHexInput(sanitizeBackgroundColor(currentBgColor));
  }, [currentBgColor]);

  const handleHexSubmit = (e) => {
    if (e.key === "Enter") {
      let val = hexInput.trim();
      if (!val.startsWith("#")) val = "#" + val;
      if (/^#[0-9A-Fa-f]{3,8}$/.test(val)) {
        onSelectColor(sanitizeBackgroundColor(val));
      }
    }
  };

  const handleHexBlur = () => {
    let val = hexInput.trim();
    if (!val.startsWith("#")) val = "#" + val;
    if (/^#[0-9A-Fa-f]{3,8}$/.test(val)) {
      onSelectColor(sanitizeBackgroundColor(val));
    } else {
      setHexInput(activeColor);
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        padding: "6px 8px 10px 8px",
        width: "100%",
        boxSizing: "border-box",
        userSelect: "none",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Header with Title and Current Color Preview */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "8px",
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "var(--color-on-surface, #475569)",
            letterSpacing: "0.02em",
          }}
        >
          Canvas background
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "0.72rem",
            color: "var(--color-on-surface-variant, #64748b)",
            fontFamily: "monospace",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              backgroundColor: activeColor,
              border: "1px solid rgba(0, 0, 0, 0.2)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
            }}
          />
          {activeColor.toUpperCase()}
        </div>
      </div>

      {/* Swatches Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: "6px",
          marginBottom: "10px",
        }}
      >
        {PRESET_BG_COLORS.map(({ color, name }) => {
          const isSelected = activeColor.toLowerCase() === color.toLowerCase();
          const isDark =
            color === "#1e293b" ||
            color === "#0f172a" ||
            color === "#121212" ||
            color === "#1e3a8a";

          return (
            <button
              key={color}
              type="button"
              title={`${name} (${color})`}
              onClick={() => onSelectColor(color)}
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                backgroundColor: color,
                border: isSelected
                  ? "2px solid #6366f1"
                  : "1px solid rgba(0, 0, 0, 0.18)",
                boxShadow: isSelected
                  ? "0 0 0 2px rgba(99, 102, 241, 0.35), 0 1px 2px rgba(0,0,0,0.1)"
                  : "0 1px 2px rgba(0,0,0,0.06)",
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
                outline: "none",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              {isSelected && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={isDark ? "#ffffff" : "#1e293b"}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {/* Custom Color Picker & Hex Input Row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        {/* Native Color Picker Trigger */}
        <label
          title="Pick any custom color"
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "30px",
            height: "28px",
            borderRadius: "6px",
            cursor: "pointer",
            background:
              "linear-gradient(135deg, #f43f5e, #fb923c, #facc15, #4ade80, #38bdf8, #818cf8, #c084fc)",
            border: "1px solid rgba(0, 0, 0, 0.15)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          <input
            type="color"
            value={
              activeColor.startsWith("#") && activeColor.length === 7
                ? activeColor
                : "#ffffff"
            }
            onChange={(e) => onSelectColor(e.target.value)}
            style={{
              position: "absolute",
              top: "-50%",
              left: "-50%",
              width: "200%",
              height: "200%",
              opacity: 0,
              cursor: "pointer",
            }}
          />
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.5))",
            }}
          >
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
          </svg>
        </label>

        {/* Direct Hex Input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flex: 1,
            height: "28px",
            borderRadius: "6px",
            border: "1px solid rgba(0, 0, 0, 0.15)",
            backgroundColor: "var(--input-bg-color, #f8fafc)",
            padding: "0 6px",
            boxSizing: "border-box",
          }}
        >
          <span
            style={{
              fontSize: "0.75rem",
              color: "#94a3b8",
              fontFamily: "monospace",
              marginRight: "2px",
            }}
          >
            #
          </span>
          <input
            type="text"
            value={hexInput.replace(/^#/, "")}
            onChange={(e) => setHexInput("#" + e.target.value)}
            onKeyDown={handleHexSubmit}
            onBlur={handleHexBlur}
            placeholder="ffffff"
            maxLength={6}
            style={{
              width: "100%",
              border: "none",
              background: "transparent",
              fontSize: "0.78rem",
              fontFamily: "monospace",
              outline: "none",
              color: "inherit",
              padding: 0,
            }}
          />
        </div>

        {/* Quick Reset to White */}
        <button
          type="button"
          title="Reset background to default white"
          onClick={() => onSelectColor("#ffffff")}
          style={{
            height: "28px",
            padding: "0 8px",
            borderRadius: "6px",
            border: "1px solid rgba(0, 0, 0, 0.15)",
            backgroundColor: "transparent",
            fontSize: "0.72rem",
            fontWeight: 500,
            color: "var(--color-on-surface-variant, #64748b)",
            cursor: "pointer",
            outline: "none",
            display: "flex",
            alignItems: "center",
            gap: "3px",
            whiteSpace: "nowrap",
          }}
        >
          Default
        </button>
      </div>
    </div>
  );
}

function ExcalidrawApp({ initialScene, initialFileId }) {
  const [fileId, setFileId] = useState(initialFileId);
  const [saveStatus, setSaveStatus] = useState("ready"); // "ready" | "saving" | "saved" | "error"
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const [currentBgColor, setCurrentBgColor] = useState(
    sanitizeBackgroundColor(initialScene?.appState?.viewBackgroundColor)
  );
  const [floatingPickerOpen, setFloatingPickerOpen] = useState(false);

  const saveTimeoutRef = useRef(null);
  const maxWaitTimerRef = useRef(null);
  const statusTimerRef = useRef(null);
  const fileIdRef = useRef(fileId);
  fileIdRef.current = fileId;
  const currentBgColorRef = useRef(currentBgColor);
  currentBgColorRef.current = currentBgColor;
  const floatingPickerRef = useRef(null);

  // Track scene fingerprint to avoid saving when only cursor/pointer moved
  const lastSavedFingerprintRef = useRef(
    getSceneFingerprint(initialScene?.elements, initialScene?.appState)
  );

  // Track latest scene in memory for instant flush when switching
  const latestSceneRef = useRef({
    elements: initialScene?.elements || [],
    appState: initialScene?.appState || {},
    files: initialScene?.files || {},
  });
  // Flag to avoid triggering false saves during file loading / switching
  const isSwitchingFileRef = useRef(false);

  // Clean up any legacy pastel defaults in browser localStorage on startup
  useEffect(() => {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("one_ead_excalidraw_appstate_")) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.viewBackgroundColor) {
              const cleaned = sanitizeBackgroundColor(parsed.viewBackgroundColor);
              if (cleaned !== parsed.viewBackgroundColor) {
                parsed.viewBackgroundColor = cleaned;
                localStorage.setItem(key, JSON.stringify(parsed));
              }
            }
          }
        }
      }
    } catch (e) {}
  }, []);

  // Close floating color picker on click outside
  useEffect(() => {
    if (!floatingPickerOpen) return;
    const handleClickOutside = (e) => {
      if (
        floatingPickerRef.current &&
        !floatingPickerRef.current.contains(e.target)
      ) {
        setFloatingPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [floatingPickerOpen]);

  // Handler to change canvas background color
  const handleBgColorChange = useCallback(
    (color) => {
      const sanitized = sanitizeBackgroundColor(color);
      setCurrentBgColor(sanitized);
      currentBgColorRef.current = sanitized;
      if (excalidrawAPI) {
        excalidrawAPI.updateScene({
          appState: {
            viewBackgroundColor: sanitized,
          },
        });
      }
    },
    [excalidrawAPI]
  );

  // Flush any pending save on current file before switching
  const flushSave = useCallback(async () => {
    if (saveTimeoutRef.current || maxWaitTimerRef.current) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
      saveTimeoutRef.current = null;
      maxWaitTimerRef.current = null;
      const currentId = fileIdRef.current;
      const { elements, appState, files } = latestSceneRef.current;
      const fingerprintToSave = getSceneFingerprint(elements, appState);
      if (fingerprintToSave === lastSavedFingerprintRef.current) {
        return;
      }
      try {
        await fetch(`/api/excalidraw/scene?file=${encodeURIComponent(currentId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            elements: elements || [],
            appState: {
              theme: appState?.theme || "light",
              viewBackgroundColor: sanitizeBackgroundColor(appState?.viewBackgroundColor),
              gridSize: appState?.gridSize,
            },
            files: files || {},
          }),
        });
        lastSavedFingerprintRef.current = fingerprintToSave;
      } catch (e) {
        console.warn("Flush save error:", e);
      }
    }
  }, []);

  // Load a file into Excalidraw with INSTANT optimistic load
  const loadFileScene = useCallback(
    async (targetId, force = false) => {
      if (!targetId || (!force && targetId === fileIdRef.current)) return;

      try {
        // 1. Flush any pending save on current file first
        await flushSave();

        // 2. Mark switching in progress so handleChange doesn't fire redundant saves
        isSwitchingFileRef.current = true;
        setFileId(targetId);
        fileIdRef.current = targetId;
        window.history.replaceState(null, "", `?file=${encodeURIComponent(targetId)}`);

        // 3. INSTANT OPTIMISTIC LOAD from localStorage (0ms delay!)
        let cachedElements = null;
        let cachedAppState = null;
        let cachedFiles = null;
        try {
          const rawEls = localStorage.getItem(ELEMENTS_KEY(targetId));
          const rawApp = localStorage.getItem(APP_STATE_KEY(targetId));
          const rawFiles = localStorage.getItem(FILES_KEY(targetId));
          if (rawEls) cachedElements = JSON.parse(rawEls);
          if (rawApp) cachedAppState = JSON.parse(rawApp);
          if (rawFiles) cachedFiles = JSON.parse(rawFiles);
        } catch (e) {}

        const instantBg = sanitizeBackgroundColor(cachedAppState?.viewBackgroundColor);
        const instantAppState = {
          theme: "light",
          ...(cachedAppState || {}),
          viewBackgroundColor: instantBg,
        };

        // Clean up legacy pastel from localStorage cache immediately
        if (cachedAppState && cachedAppState.viewBackgroundColor !== instantBg) {
          try {
            localStorage.setItem(APP_STATE_KEY(targetId), JSON.stringify(instantAppState));
          } catch (e) {}
        }

        const instantElements = cachedElements || [];
        const instantFiles = cachedFiles || {};

        latestSceneRef.current = {
          elements: instantElements,
          appState: instantAppState,
          files: instantFiles,
        };
        lastSavedFingerprintRef.current = getSceneFingerprint(instantElements, instantAppState);

        setCurrentBgColor(instantBg);
        currentBgColorRef.current = instantBg;

        if (excalidrawAPI) {
          if (typeof excalidrawAPI.resetScene === "function") {
            excalidrawAPI.resetScene();
          }
          excalidrawAPI.updateScene({
            elements: instantElements,
            appState: instantAppState,
            files: instantFiles,
            scrollToContent: instantElements.length > 0,
          });
          if (typeof excalidrawAPI.history?.clear === "function") {
            excalidrawAPI.history.clear();
          }
        }

        // Notify parent immediately that file loaded
        try {
          window.parent.postMessage(
            {
              type: "EXCALIDRAW_FILE_LOADED",
              fileId: targetId,
              count: instantElements.length,
            },
            "*"
          );
        } catch (e) {}

        // 4. In background, fetch authoritative server copy and reconcile
        const res = await fetch(`/api/excalidraw/scene?file=${encodeURIComponent(targetId)}`);
        if (res.ok && fileIdRef.current === targetId) {
          const serverScene = await res.json();
          const serverElements = serverScene?.elements || [];
          const serverBg = sanitizeBackgroundColor(serverScene?.appState?.viewBackgroundColor);
          const serverAppState = {
            theme: "light",
            ...(serverScene?.appState || {}),
            viewBackgroundColor: serverBg,
          };
          const serverFiles = serverScene?.files || {};

          latestSceneRef.current = {
            elements: serverElements,
            appState: serverAppState,
            files: serverFiles,
          };
          lastSavedFingerprintRef.current = getSceneFingerprint(serverElements, serverAppState);

          setCurrentBgColor(serverBg);
          currentBgColorRef.current = serverBg;

          if (excalidrawAPI) {
            if (typeof excalidrawAPI.resetScene === "function") {
              excalidrawAPI.resetScene();
            }
            excalidrawAPI.updateScene({
              elements: serverElements,
              appState: serverAppState,
              files: serverFiles,
              scrollToContent: serverElements.length > 0,
            });
            if (typeof excalidrawAPI.history?.clear === "function") {
              excalidrawAPI.history.clear();
            }
          }
        }
      } catch (err) {
        console.warn("Could not load scene for file:", targetId, err);
      } finally {
        setTimeout(() => {
          isSwitchingFileRef.current = false;
        }, 100);
      }
    },
    [excalidrawAPI, flushSave]
  );

  // Listen for file change and deletion messages from the parent window (Right Panel)
  useEffect(() => {
    const handleMessage = (e) => {
      if (!e.data) return;
      if (e.data.type === "LOAD_DRAWING_FILE" && e.data.fileId) {
        loadFileScene(e.data.fileId, e.data.force || false);
      } else if (e.data.type === "DRAWING_DELETED" && e.data.fileId) {
        const deletedId = e.data.fileId;
        // 1. Cancel pending save if it's for this file
        if (fileIdRef.current === deletedId) {
          if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
          if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
          saveTimeoutRef.current = null;
          maxWaitTimerRef.current = null;
          setSaveStatus("ready");
        }
        // 2. Clear localStorage caches for this file
        try {
          localStorage.removeItem(ELEMENTS_KEY(deletedId));
          localStorage.removeItem(APP_STATE_KEY(deletedId));
          localStorage.removeItem(FILES_KEY(deletedId));
        } catch (err) {}
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [loadFileScene]);

  const performSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (maxWaitTimerRef.current) {
      clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }

    const currentId = fileIdRef.current;
    const { elements, appState, files } = latestSceneRef.current;
    const fingerprintToSave = getSceneFingerprint(elements, appState);
    if (fingerprintToSave === lastSavedFingerprintRef.current) {
      return;
    }

    setSaveStatus("saving");

    // LocalStorage sync
    try {
      if (elements && elements.length > 0) {
        localStorage.setItem(ELEMENTS_KEY(currentId), JSON.stringify(elements));
      } else {
        localStorage.removeItem(ELEMENTS_KEY(currentId));
      }
      if (appState) {
        localStorage.setItem(
          APP_STATE_KEY(currentId),
          JSON.stringify({
            theme: appState.theme || "light",
            viewBackgroundColor: sanitizeBackgroundColor(appState.viewBackgroundColor),
            gridSize: appState.gridSize,
          })
        );
      }
      if (files && Object.keys(files).length > 0) {
        localStorage.setItem(FILES_KEY(currentId), JSON.stringify(files));
      }
    } catch (err) {}

    try {
      const payload = {
        elements: elements || [],
        appState: {
          theme: appState?.theme || "light",
          viewBackgroundColor: sanitizeBackgroundColor(appState?.viewBackgroundColor),
          gridSize: appState?.gridSize,
        },
        files: files || {},
      };

      const res = await fetch(`/api/excalidraw/scene?file=${encodeURIComponent(currentId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        lastSavedFingerprintRef.current = fingerprintToSave;
        setSaveStatus("saved");
        try {
          window.parent.postMessage(
            {
              type: "EXCALIDRAW_SAVED",
              fileId: currentId,
              count: elements.length,
            },
            "*"
          );
        } catch (e) {}

        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        statusTimerRef.current = setTimeout(() => {
          setSaveStatus("ready");
        }, 1200);
      } else {
        setSaveStatus("error");
      }
    } catch (e) {
      console.warn("Server save error:", e);
      setSaveStatus("error");
    }
  }, []);

  const handleChange = (elements, appState, files) => {
    latestSceneRef.current = { elements, appState, files };

    // Synchronize background color if changed internally (e.g. via theme switch)
    if (
      appState?.viewBackgroundColor &&
      appState.viewBackgroundColor !== currentBgColorRef.current
    ) {
      const sanitized = sanitizeBackgroundColor(appState.viewBackgroundColor);
      currentBgColorRef.current = sanitized;
      setCurrentBgColor(sanitized);
    }

    if (isSwitchingFileRef.current) {
      return;
    }

    // Fast check: if canvas shapes / colors haven't changed, ignore cursor/hover/zoom events
    const currentFingerprint = getSceneFingerprint(elements, appState);
    if (currentFingerprint === lastSavedFingerprintRef.current) {
      return;
    }

    // Debounced save to server (300ms) with max-wait throttle (1200ms)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(performSave, 300);

    if (!maxWaitTimerRef.current) {
      maxWaitTimerRef.current = setTimeout(performSave, 1200);
    }
  };

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      {/* Quick Floating Background Color Control */}
      <div
        ref={floatingPickerRef}
        style={{
          position: "fixed",
          bottom: 14,
          right: 195,
          zIndex: 100,
        }}
      >
        <button
          type="button"
          title="Change canvas background color"
          onClick={() => setFloatingPickerOpen((prev) => !prev)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 20,
            fontSize: 11,
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontWeight: 500,
            cursor: "pointer",
            background: "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(6px)",
            color: "#334155",
            border: "1px solid rgba(0, 0, 0, 0.12)",
            boxShadow: "0 2px 5px rgba(0,0,0,0.08)",
            transition: "all 0.2s ease",
            outline: "none",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = "0 3px 8px rgba(0,0,0,0.15)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = "0 2px 5px rgba(0,0,0,0.08)";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: currentBgColor || "#ffffff",
              border: "1px solid rgba(0, 0, 0, 0.25)",
              boxShadow: "inset 0 1px 1px rgba(0,0,0,0.1)",
            }}
          />
          <span>Background</span>
        </button>

        {floatingPickerOpen && (
          <div
            style={{
              position: "absolute",
              bottom: "calc(100% + 8px)",
              right: 0,
              backgroundColor: "#ffffff",
              borderRadius: 12,
              boxShadow:
                "0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
              border: "1px solid rgba(0, 0, 0, 0.1)",
              width: 240,
              padding: 4,
              zIndex: 101,
            }}
          >
            <CanvasBackgroundColorPicker
              currentBgColor={currentBgColor}
              onSelectColor={handleBgColorChange}
            />
          </div>
        )}
      </div>

      {/* Save Status Badge */}
      <div
        style={{
          position: "fixed",
          bottom: 14,
          right: 56,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 20,
          fontSize: 11,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontWeight: 500,
          pointerEvents: "none",
          transition: "all 0.25s ease",
          background:
            saveStatus === "saving"
              ? "rgba(234, 179, 8, 0.15)"
              : saveStatus === "saved"
              ? "rgba(22, 163, 74, 0.15)"
              : saveStatus === "error"
              ? "rgba(239, 68, 68, 0.15)"
              : "rgba(0, 0, 0, 0.05)",
          color:
            saveStatus === "saving"
              ? "#a16207"
              : saveStatus === "saved"
              ? "#15803d"
              : saveStatus === "error"
              ? "#b91c1c"
              : "#64748b",
          border: `1px solid ${
            saveStatus === "saving"
              ? "rgba(234, 179, 8, 0.3)"
              : saveStatus === "saved"
              ? "rgba(22, 163, 74, 0.3)"
              : saveStatus === "error"
              ? "rgba(239, 68, 68, 0.3)"
              : "rgba(0, 0, 0, 0.08)"
          }`,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            backgroundColor:
              saveStatus === "saving"
                ? "#eab308"
                : saveStatus === "saved"
                ? "#16a34a"
                : saveStatus === "error"
                ? "#ef4444"
                : "#94a3b8",
          }}
        />
        {saveStatus === "saving"
          ? "Saving to disk..."
          : saveStatus === "saved"
          ? "Saved to disk"
          : saveStatus === "error"
          ? "Save failed (cached locally)"
          : "Disk auto-save on"}
      </div>

      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        initialData={initialScene}
        onChange={handleChange}
        theme="light"
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: true,
            clearCanvas: true,
            loadScene: true,
            saveToActiveFile: false,
            theme: true,
            saveAsImage: true,
          },
        }}
      >
        {/* Customized Main Menu: Excalidraw social links completely removed,
            replaced with rich background color selector */}
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.Separator />
          <MainMenu.ItemCustom>
            <CanvasBackgroundColorPicker
              currentBgColor={currentBgColor}
              onSelectColor={handleBgColorChange}
            />
          </MainMenu.ItemCustom>
        </MainMenu>
      </Excalidraw>
    </div>
  );
}

// Fetch persisted scene from disk before rendering Excalidraw
async function init() {
  const currentFileId = getFileIdFromUrl();
  let initialScene = null;

  // 1. Try localStorage first for instant boot (0ms)
  try {
    const savedElements = localStorage.getItem(ELEMENTS_KEY(currentFileId));
    const savedAppState = localStorage.getItem(APP_STATE_KEY(currentFileId));
    const savedFiles = localStorage.getItem(FILES_KEY(currentFileId));

    if (savedElements || savedAppState) {
      const elements = savedElements ? JSON.parse(savedElements) : [];
      let appState = savedAppState ? JSON.parse(savedAppState) : {};
      const files = savedFiles ? JSON.parse(savedFiles) : {};

      const bg = sanitizeBackgroundColor(appState.viewBackgroundColor);
      appState = {
        theme: "light",
        ...appState,
        viewBackgroundColor: bg,
      };

      if (savedAppState && JSON.stringify(appState) !== savedAppState) {
        localStorage.setItem(APP_STATE_KEY(currentFileId), JSON.stringify(appState));
      }

      initialScene = {
        elements,
        appState,
        files,
        scrollToContent: elements.length > 0,
      };
    }
  } catch (e) {}

  // 2. Try server disk file if not in localStorage
  if (!initialScene) {
    try {
      const res = await fetch(`/api/excalidraw/scene?file=${encodeURIComponent(currentFileId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.elements)) {
          const bg = sanitizeBackgroundColor(data.appState?.viewBackgroundColor);
          initialScene = {
            elements: data.elements,
            appState: {
              theme: "light",
              ...(data.appState || {}),
              viewBackgroundColor: bg,
            },
            files: data.files || {},
            scrollToContent: data.elements.length > 0,
          };
        }
      }
    } catch (err) {
      console.warn("Could not load scene from server:", err);
    }
  }

  // 3. Fallback blank whiteboard with default pure white background
  if (!initialScene) {
    initialScene = {
      elements: [],
      appState: { theme: "light", viewBackgroundColor: "#ffffff" },
      files: {},
      scrollToContent: false,
    };
  }

  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(<ExcalidrawApp initialScene={initialScene} initialFileId={currentFileId} />);
}

init();
