import { useCallback, useState } from "react";
import { COMPONENT_BY_ID, MM20 } from "../../data";
import { ComponentPanel } from "../ParameterPanel/ComponentPanel";
import { ParameterDetail } from "../ParameterPanel/ParameterDetail";
import { SourceRefs } from "../SourcePanel/SourceRefs";
import { MicrophoneScene, type ViewState } from "./MicrophoneScene";
import { ViewControls } from "./ViewControls";

export function Explorer3D({ dark }: { dark: boolean }) {
  const [view, setView] = useState<ViewState>({
    explode: 0,
    cutaway: true,
    transparentPackage: false,
    labels: true,
    hidden: new Set(),
  });
  const [selectedId, setSelectedId] = useState<string | null>("comp.diaphragm");
  const [detailId, setDetailId] = useState<string | null>("comp.diaphragm");
  const [resetToken, setResetToken] = useState(0);

  const selectComponent = useCallback((id: string | null) => {
    setSelectedId(id);
    setDetailId(id);
  }, []);

  const navigate = useCallback((id: string) => {
    if (COMPONENT_BY_ID.has(id)) {
      setSelectedId(id);
      setDetailId(id);
    } else {
      setDetailId(id);
    }
  }, []);

  const showingParameter = detailId !== null && !COMPONENT_BY_ID.has(detailId);

  return (
    <div className="grid h-full min-h-0 grid-cols-[230px_1fr_400px]">
      <aside className="min-h-0 overflow-y-auto border-r border-line bg-panel p-3">
        <ViewControls
          view={view}
          setView={setView}
          selectedId={selectedId}
          onSelect={selectComponent}
          onResetCamera={() => setResetToken((t) => t + 1)}
        />
      </aside>

      <main className="relative min-h-0 min-w-0">
        <MicrophoneScene view={view} selectedId={selectedId} onSelect={selectComponent} resetToken={resetToken} dark={dark} />
        <div className="pointer-events-none absolute left-3 top-3 max-w-[520px] space-y-1">
          <div className="rounded-sm border border-concept bg-black/60 px-2 py-1 font-mono text-[11px] text-concept">
            CONCEPTUAL MEMS ARCHITECTURE — internal geometry and layer thicknesses are illustrative, not the actual MM20 construction.
          </div>
          <div className="rounded-sm border border-mm20 bg-black/60 px-2 py-1 font-mono text-[11px] text-mm20">
            {MM20.name} ({MM20.partNumber}): outer envelope {MM20.package.length} × {MM20.package.width} × {MM20.package.height} mm and
            bottom-port position follow the datasheet drawing.
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10.5px] text-slate-300/80">
          drag: orbit · right-drag: pan · wheel: zoom · click a part to inspect
        </div>
      </main>

      <aside className="min-h-0 overflow-y-auto border-l border-line bg-panel p-3">
        {detailId === null ? (
          <div className="space-y-2 text-dim">
            <p>Select a component in the 3D model or in the list to see its function, parameters, equations and sources.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {showingParameter && selectedId && (
              <button
                type="button"
                className="font-mono text-[11px] text-accent hover:underline"
                onClick={() => setDetailId(selectedId)}
              >
                ← back to {COMPONENT_BY_ID.get(selectedId)?.name}
              </button>
            )}
            {showingParameter ? (
              <ParameterDetail id={detailId} onNavigate={navigate} />
            ) : (
              <ComponentPanel id={detailId} onNavigate={navigate} />
            )}
            {!showingParameter && (
              <div className="border-t border-line pt-2">
                <SourceRefs ids={[MM20.datasheetSourceId]} label="MM20 reference document" />
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
