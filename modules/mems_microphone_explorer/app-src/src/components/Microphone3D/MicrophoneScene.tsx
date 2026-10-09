import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { COMPONENT_BY_ID } from "../../data";
import {
  BACKPLATE_T,
  DIAPHRAGM_R,
  DIAPHRAGM_T,
  DIE_BORE_R,
  DIE_SIZE,
  DIE_T,
  GAP_T,
  H,
  INNER_H,
  L,
  PART_STYLE,
  PERFORATION_HOLES,
  PORT_R,
  PORT_X,
  RING_R,
  T_SUB,
  W,
  WALL,
  Y_BACKPLATE,
  Y_DIAPHRAGM,
  Y_GAP,
  perforatedDisc,
  slabWithHole,
} from "./model";

export interface ViewState {
  explode: number;
  cutaway: boolean;
  transparentPackage: boolean;
  labels: boolean;
  hidden: ReadonlySet<string>;
}

interface SceneProps {
  view: ViewState;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  resetToken: number;
  dark: boolean;
}

interface PartProps {
  id: string;
  view: ViewState;
  selectedId: string | null;
  hoveredId: string | null;
  setHovered: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  /** When false the part is drawn but ignores the pointer (so parts behind it stay clickable). */
  pickable?: boolean;
  opacity?: number;
  children: (mat: { color: string; emissive: THREE.Color; emissiveIntensity: number; opacity: number; transparent: boolean }) => React.ReactNode;
}

const ACCENT = new THREE.Color("#2dd4bf");

function Part({ id, view, selectedId, hoveredId, setHovered, onSelect, pickable = true, opacity = 1, children }: PartProps) {
  const style = PART_STYLE[id];
  if (view.hidden.has(id)) return null;
  const selected = selectedId === id;
  const hovered = hoveredId === id;
  const off = new THREE.Vector3((style.explodeX ?? 0) * view.explode, style.explodeY * view.explode, 0);
  const label = COMPONENT_BY_ID.get(id)?.label ?? id;

  const handlers = pickable
    ? {
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelect(id);
        },
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(id);
          document.body.style.cursor = "pointer";
        },
        onPointerOut: () => {
          setHovered(null);
          document.body.style.cursor = "";
        },
      }
    : {};

  return (
    <group position={off} {...handlers}>
      {children({
        color: style.color,
        emissive: selected || hovered ? ACCENT : new THREE.Color("#000000"),
        emissiveIntensity: selected ? 0.55 : hovered ? 0.28 : 0,
        opacity,
        transparent: opacity < 1,
      })}
      {view.labels && (
        <Html position={style.labelAt} center distanceFactor={9} style={{ pointerEvents: "none" }}>
          <div
            style={{
              font: "600 10px ui-monospace, Consolas, monospace",
              color: selected ? "#2dd4bf" : "#e4ebf4",
              background: "rgba(8,14,22,0.78)",
              border: `1px solid ${selected ? "#2dd4bf" : "#3b4a60"}`,
              padding: "1px 5px",
              borderRadius: 2,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}

function Mat({ m, side }: { m: Parameters<PartProps["children"]>[0]; side?: THREE.Side }) {
  return (
    <meshStandardMaterial
      color={m.color}
      emissive={m.emissive}
      emissiveIntensity={m.emissiveIntensity}
      transparent={m.transparent}
      opacity={m.opacity}
      depthWrite={!m.transparent}
      roughness={0.55}
      metalness={0.25}
      side={side}
    />
  );
}

function Wire({ points, m }: { points: [number, number, number][]; m: Parameters<PartProps["children"]>[0] }) {
  const geo = useMemo(
    () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 24, 0.012, 6, false),
    [points],
  );
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial
        color={m.color}
        emissive={m.emissive}
        emissiveIntensity={m.emissiveIntensity}
        metalness={0.7}
        roughness={0.3}
      />
    </mesh>
  );
}

function Microphone({ view, selectedId, onSelect }: Omit<SceneProps, "resetToken" | "dark">) {
  const [hovered, setHovered] = useState<string | null>(null);
  const common = { view, selectedId, hoveredId: hovered, setHovered, onSelect };
  const pkgOpacity = view.transparentPackage ? 0.28 : 1;
  const pkgPick = !view.transparentPackage;

  const substrate = useMemo(() => slabWithHole(L, W, { x: PORT_X, z: 0, r: PORT_R }, T_SUB), []);
  const die = useMemo(() => slabWithHole(DIE_SIZE, DIE_SIZE, { x: PORT_X, z: 0, r: DIE_BORE_R }, DIE_T, PORT_X, 0), []);
  const backplate = useMemo(() => perforatedDisc(DIAPHRAGM_R, PERFORATION_HOLES, BACKPLATE_T), []);
  const ring = useMemo(() => perforatedDisc(RING_R, [{ x: 0, z: 0, r: PORT_R }], 0.03), []);
  const innerX = L - 2 * WALL;
  const innerZ = W - 2 * WALL;
  const yMid = T_SUB + INNER_H / 2;

  const wires: [number, number, number][][] = useMemo(
    () => [
      [[PORT_X + 0.5, T_SUB + DIE_T, 0.15], [PORT_X + 0.8, 0.78, 0.15], [0.2, 0.42, 0.15]],
      [[PORT_X + 0.5, T_SUB + DIE_T, -0.15], [PORT_X + 0.8, 0.78, -0.15], [0.2, 0.42, -0.15]],
      [[0.95, 0.42, -0.6], [1.15, 0.7, -0.6], [1.3, T_SUB, -0.6]],
      [[0.95, 0.42, 0], [1.15, 0.7, 0], [1.3, T_SUB, 0]],
      [[0.95, 0.42, 0.6], [1.15, 0.7, 0.6], [1.3, T_SUB, 0.6]],
    ],
    [],
  );

  return (
    <group>
      {/* Package base (substrate with the sound-port hole) */}
      <Part id="comp.package" {...common} opacity={pkgOpacity} pickable={pkgPick}>
        {(m) => (
          <mesh geometry={substrate} position={[0, 0, 0]}>
            <Mat m={m} />
          </mesh>
        )}
      </Part>

      {/* Lid (metal can). Front wall removed in cutaway so the interior is visible. */}
      <Part id="comp.lid" {...common} opacity={pkgOpacity} pickable={pkgPick}>
        {(m) => (
          <group>
            <mesh position={[0, H - WALL / 2, 0]}>
              <boxGeometry args={[L, WALL, W]} />
              <Mat m={m} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={`x${s}`} position={[s * (L / 2 - WALL / 2), yMid, 0]}>
                <boxGeometry args={[WALL, INNER_H, W]} />
                <Mat m={m} />
              </mesh>
            ))}
            <mesh position={[0, yMid, -(W / 2 - WALL / 2)]}>
              <boxGeometry args={[innerX, INNER_H, WALL]} />
              <Mat m={m} />
            </mesh>
            {!view.cutaway && (
              <mesh position={[0, yMid, W / 2 - WALL / 2]}>
                <boxGeometry args={[innerX, INNER_H, WALL]} />
                <Mat m={m} />
              </mesh>
            )}
          </group>
        )}
      </Part>

      {/* Package cavity: translucent air volume, not pickable so internal parts stay clickable */}
      <Part id="comp.cavity" {...common} pickable={false} opacity={0.09}>
        {(m) => (
          <mesh position={[0, yMid, 0]}>
            <boxGeometry args={[innerX, INNER_H, innerZ]} />
            <Mat m={m} />
          </mesh>
        )}
      </Part>

      {/* Acoustic port: through-hole sleeve + ground ring on the underside */}
      <Part id="comp.port" {...common}>
        {(m) => (
          <group>
            <mesh position={[PORT_X, T_SUB / 2, 0]}>
              <cylinderGeometry args={[PORT_R - 0.005, PORT_R - 0.005, T_SUB + 0.002, 40, 1, true]} />
              <meshStandardMaterial
                color={m.color}
                emissive={m.emissive}
                emissiveIntensity={m.emissiveIntensity}
                transparent
                opacity={0.55}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            <mesh geometry={ring} position={[PORT_X, -0.03, 0]}>
              <Mat m={m} />
            </mesh>
          </group>
        )}
      </Part>

      {/* MEMS die with etched bore */}
      <Part id="comp.die" {...common}>
        {(m) => (
          <mesh geometry={die} position={[0, T_SUB, 0]}>
            <Mat m={m} />
          </mesh>
        )}
      </Part>

      {/* Diaphragm */}
      <Part id="comp.diaphragm" {...common}>
        {(m) => (
          <mesh position={[PORT_X, Y_DIAPHRAGM, 0]}>
            <cylinderGeometry args={[DIAPHRAGM_R, DIAPHRAGM_R, DIAPHRAGM_T, 48]} />
            <Mat m={m} />
          </mesh>
        )}
      </Part>

      {/* Air gap */}
      <Part id="comp.airgap" {...common} opacity={0.5}>
        {(m) => (
          <mesh position={[PORT_X, Y_GAP, 0]}>
            <cylinderGeometry args={[DIAPHRAGM_R - 0.02, DIAPHRAGM_R - 0.02, GAP_T, 48]} />
            <Mat m={m} />
          </mesh>
        )}
      </Part>

      {/* Backplate (with perforation holes) */}
      <Part id="comp.backplate" {...common}>
        {(m) => (
          <mesh geometry={backplate} position={[PORT_X, Y_BACKPLATE - BACKPLATE_T / 2, 0]}>
            <Mat m={m} side={THREE.DoubleSide} />
          </mesh>
        )}
      </Part>

      {/* Perforation plugs (highlight the holes) */}
      <Part id="comp.perforations" {...common}>
        {(m) => (
          <group position={[PORT_X, Y_BACKPLATE, 0]}>
            {PERFORATION_HOLES.map((h, i) => (
              <mesh key={i} position={[h.x, 0, h.z]}>
                <cylinderGeometry args={[h.r * 0.9, h.r * 0.9, BACKPLATE_T * 1.05, 12]} />
                <Mat m={m} />
              </mesh>
            ))}
          </group>
        )}
      </Part>

      {/* ASIC */}
      <Part id="comp.asic" {...common}>
        {(m) => (
          <mesh position={[0.55, T_SUB + 0.11, 0]}>
            <boxGeometry args={[0.8, 0.22, 0.8]} />
            <Mat m={m} />
          </mesh>
        )}
      </Part>

      {/* Bond wires */}
      <Part id="comp.bondwires" {...common}>
        {(m) => (
          <group>
            {wires.map((pts, i) => (
              <Wire key={i} points={pts} m={m} />
            ))}
          </group>
        )}
      </Part>

      {/* Electrical pads on the underside */}
      <Part id="comp.pads" {...common}>
        {(m) => (
          <group>
            {[
              { z: -0.75, w: 0.5 },
              { z: 0, w: 0.3 },
              { z: 0.75, w: 0.5 },
            ].map((p) => (
              <mesh key={p.z} position={[1.25, -0.015, p.z]}>
                <boxGeometry args={[0.5, 0.03, p.w]} />
                <Mat m={m} />
              </mesh>
            ))}
          </group>
        )}
      </Part>
    </group>
  );
}

export function MicrophoneScene({ view, selectedId, onSelect, resetToken, dark }: SceneProps) {
  const controls = useRef<OrbitControlsImpl | null>(null);

  useEffect(() => {
    if (resetToken > 0) controls.current?.reset();
  }, [resetToken]);

  return (
    <Canvas
      camera={{ position: [1.2, 2.4, 6.2], fov: 32, near: 0.1, far: 100 }}
      onPointerMissed={() => onSelect(null)}
      dpr={[1, 2]}
    >
      <color attach="background" args={[dark ? "#070c13" : "#101a28"]} />
      <hemisphereLight args={["#dbe7ff", "#1a2433", 0.9]} />
      <directionalLight position={[4, 6, 5]} intensity={1.6} />
      <directionalLight position={[-5, 2, -3]} intensity={0.5} />
      <gridHelper args={[12, 24, "#3b4a60", "#223045"]} position={[0, -1.1, 0]} />
      <Microphone view={view} selectedId={selectedId} onSelect={onSelect} />
      <OrbitControls ref={controls} makeDefault target={[0, 0.5, 0]} enableDamping minDistance={2} maxDistance={20} />
    </Canvas>
  );
}
