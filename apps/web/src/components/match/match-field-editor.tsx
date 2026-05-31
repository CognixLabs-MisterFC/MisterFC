'use client';

/**
 * F6.3 — <MatchFieldEditor>. Campo de fútbol SVG con jugadores como chips
 * sobre las posiciones de la formación elegida. Fundación reutilizable por F7
 * (toma de datos en directo) — ver ADR-0009.
 *
 * Modos (prop `mode`):
 *   - 'edit'         → chips arrastrables (dnd-kit) y slots como zonas de drop.
 *                      DEBE renderizarse dentro de un <DndContext> provisto por
 *                      la página, que también envuelve los paneles de banquillo
 *                      y fuera (F6.7) para permitir el drag campo↔banquillo. El
 *                      onDragEnd de ESE contexto interpreta los ids con los
 *                      helpers exportados aquí abajo y persiste el movimiento.
 *   - 'readonly'     → estático, sin drag. Para la vista de familia/jugador y
 *                      la previsualización de notas (Lote B).
 *   - 'live-overlay' → STUB para F7: estático + clic en jugador/césped + slot
 *                      para overlays (`children`). El drag de eventos lo añade
 *                      F7 encima; aquí solo se exponen los callbacks.
 *
 * El componente solo conoce jugadores y posiciones. NO tiene lógica de eventos
 * de partido (ADR-0009).
 */

import { type ReactNode, useId } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  fieldSlotDroppableId,
  getFormation,
  playerDraggableId,
  type Formation,
  type TeamFormat,
} from '@misterfc/core';
import { cn } from '@/lib/utils';

// Ids de drag&drop centralizados en @misterfc/core/lineups/editor (compartidos
// con el cliente de la página). El droppable de slot es `lineup-slot:<code>`;
// el draggable de jugador `lineup-player:<id>`; el banquillo usa BENCH_ZONE_ID.
// Se re-exportan para consumidores del componente. (Rediseño Lote B': ya no hay
// zona "out".)
export {
  FIELD_SLOT_PREFIX,
  PLAYER_DRAG_PREFIX,
  BENCH_ZONE_ID,
  fieldSlotDroppableId,
  playerDraggableId,
  parseFieldSlotId,
  parsePlayerDragId,
} from '@misterfc/core';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

export type FieldMode = 'edit' | 'readonly' | 'live-overlay';

export interface FieldEditorPlayer {
  playerId: string;
  /** Nombre corto a mostrar en el chip (p.ej. "A. Pérez"). */
  label: string;
  dorsal: number | null;
  /** Posición primaria del jugador (POR/DEF/MED/DEL) — Mejora 1. */
  positionLabel?: string | null;
  /** Foto del jugador (players.photo_url) — Mejora I. Fallback: dorsal. */
  photoUrl?: string | null;
  /** Slot del preset que ocupa este jugador. */
  positionCode: string | null;
  /** Coordenadas propias; si null se usan las del slot del preset. */
  xPct?: number | null;
  yPct?: number | null;
}

export interface MatchFieldEditorProps {
  format: TeamFormat;
  formationCode: string;
  /** Jugadores actualmente en el campo (location='field'). */
  players: FieldEditorPlayer[];
  mode?: FieldMode;
  onPlayerClick?: (playerId: string) => void;
  onFieldClick?: (xPct: number, yPct: number) => void;
  onPlayerHover?: (playerId: string | null) => void;
  /** Overlays absolutos sobre el campo (cronómetro/paleta de F7). */
  children?: ReactNode;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponentes
// ─────────────────────────────────────────────────────────────────────────────

function ChipBody({
  player,
  hover,
}: {
  player: FieldEditorPlayer;
  hover?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-0.5 select-none',
        hover && 'opacity-90',
      )}
    >
      <div className="relative size-9 overflow-hidden rounded-full border-2 border-white bg-emerald-700 shadow-md">
        {player.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={player.photoUrl}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-sm font-bold text-white">
            {player.dorsal ?? '·'}
          </span>
        )}
      </div>
      <span className="max-w-16 truncate rounded bg-black/55 px-1 text-[10px] leading-tight text-white">
        {player.positionLabel ? `${player.positionLabel} · ` : ''}
        {player.label}
      </span>
    </div>
  );
}

function DraggableChip({
  player,
  onHover,
}: {
  player: FieldEditorPlayer;
  onHover?: (id: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: playerDraggableId(player.playerId) });
  return (
    <button
      type="button"
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        'cursor-grab touch-none active:cursor-grabbing',
        isDragging && 'z-20 opacity-80',
      )}
      onMouseEnter={() => onHover?.(player.playerId)}
      onMouseLeave={() => onHover?.(null)}
      aria-label={player.label}
      {...listeners}
      {...attributes}
    >
      <ChipBody player={player} />
    </button>
  );
}

function EditableSlot({
  slotCode,
  xPct,
  yPct,
  player,
  onHover,
}: {
  slotCode: string;
  xPct: number;
  yPct: number;
  player: FieldEditorPlayer | undefined;
  onHover?: (id: string | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: fieldSlotDroppableId(slotCode),
  });
  return (
    <div
      ref={setNodeRef}
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${xPct}%`, top: `${yPct}%` }}
    >
      {player ? (
        <DraggableChip player={player} onHover={onHover} />
      ) : (
        <div
          className={cn(
            'flex size-9 items-center justify-center rounded-full border-2 border-dashed border-white/70 text-[10px] text-white/80',
            isOver && 'scale-110 border-white bg-white/20',
          )}
        >
          {slotCode}
        </div>
      )}
    </div>
  );
}

function StaticChip({
  player,
  xPct,
  yPct,
  clickable,
  onClick,
  onHover,
}: {
  player: FieldEditorPlayer;
  xPct: number;
  yPct: number;
  clickable: boolean;
  onClick?: (id: string) => void;
  onHover?: (id: string | null) => void;
}) {
  return (
    <div
      className={cn(
        'absolute -translate-x-1/2 -translate-y-1/2',
        clickable && 'cursor-pointer',
      )}
      style={{ left: `${xPct}%`, top: `${yPct}%` }}
      onClick={clickable ? () => onClick?.(player.playerId) : undefined}
      onMouseEnter={() => onHover?.(player.playerId)}
      onMouseLeave={() => onHover?.(null)}
    >
      <ChipBody player={player} />
    </div>
  );
}

/** Marcas del campo (SVG decorativo, no interactivo). Atacando hacia arriba. */
function Pitch() {
  return (
    <svg
      viewBox="0 0 100 150"
      preserveAspectRatio="none"
      className="absolute inset-0 size-full"
      aria-hidden
    >
      <rect x="0" y="0" width="100" height="150" fill="#15803d" />
      <g fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.6">
        <rect x="3" y="3" width="94" height="144" />
        <line x1="3" y1="75" x2="97" y2="75" />
        <circle cx="50" cy="75" r="11" />
        {/* Área propia (abajo) y rival (arriba). */}
        <rect x="22" y="123" width="56" height="24" />
        <rect x="22" y="3" width="56" height="24" />
      </g>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

function slotCoords(
  formation: Formation | undefined,
  player: FieldEditorPlayer,
): { x: number; y: number } | null {
  if (player.xPct != null && player.yPct != null) {
    return { x: player.xPct, y: player.yPct };
  }
  const slot = formation?.slots.find((s) => s.code === player.positionCode);
  return slot ? { x: slot.xPct, y: slot.yPct } : null;
}

export function MatchFieldEditor({
  format,
  formationCode,
  players,
  mode = 'readonly',
  onPlayerClick,
  onFieldClick,
  onPlayerHover,
  children,
  className,
}: MatchFieldEditorProps) {
  const labelId = useId();
  const formation = getFormation(formationCode);
  const byCode = new Map(
    players.filter((p) => p.positionCode).map((p) => [p.positionCode!, p]),
  );

  function handleFieldClick(e: React.MouseEvent<HTMLDivElement>) {
    if (mode !== 'live-overlay' || !onFieldClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    onFieldClick(
      Math.round(xPct * 100) / 100,
      Math.round(yPct * 100) / 100,
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn(
        'relative mx-auto aspect-[2/3] w-full max-w-md overflow-hidden rounded-lg',
        className,
      )}
      onClick={mode === 'live-overlay' ? handleFieldClick : undefined}
    >
      <span id={labelId} className="sr-only">
        {`Campo ${format} · formación ${formationCode}`}
      </span>
      <Pitch />

      {/* Degradación elegante si la formación no está en el catálogo. */}
      {!formation && (
        <p className="absolute left-1/2 top-2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-amber-200">
          formación «{formationCode}» no reconocida
        </p>
      )}

      {mode === 'edit' && formation
        ? // Edit: todos los slots del preset, drop targets + chips arrastrables.
          formation.slots.map((slot) => (
            <EditableSlot
              key={slot.code}
              slotCode={slot.code}
              xPct={slot.xPct}
              yPct={slot.yPct}
              player={byCode.get(slot.code)}
              onHover={onPlayerHover}
            />
          ))
        : // readonly / live-overlay / sin formación: chips estáticos.
          players.map((player) => {
            const c = slotCoords(formation, player);
            if (!c) return null;
            return (
              <StaticChip
                key={player.playerId}
                player={player}
                xPct={c.x}
                yPct={c.y}
                clickable={mode === 'live-overlay' && !!onPlayerClick}
                onClick={onPlayerClick}
                onHover={onPlayerHover}
              />
            );
          })}

      {/* Overlays externos (F7): cronómetro, paleta de eventos, etc. */}
      {children}
    </div>
  );
}
