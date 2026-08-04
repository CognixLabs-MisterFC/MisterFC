import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyDrainResult,
  countFailed,
  countPending,
  enqueueEvent,
  failedEntries,
  overlayRows,
  pendingForDrain,
  pruneConfirmed,
  resetFailedToPending,
  upsertMatchEventFromClient,
  EMPTY_QUEUE,
  type DrainResult,
  type EventQueue,
  type QueuedEvent,
  type QueuedMatchEventRow,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { getIsOnline } from '@/data/connectivity';
import { loadQueue, saveQueue } from './event-queue-store';

/**
 * O2-9b — Orquestación de la COLA de eventos del directo (la única escritura
 * offline). Carga la cola persistida (secure-store) del partido, expone el
 * registro OPTIMISTA (encolar + persistir + pintar al instante) y drena al
 * servidor con upsert idempotente cuando hay red. El motor de la cola (estructura,
 * transiciones, idempotencia) es PURO en core; aquí solo van la persistencia, la
 * detección de red y el bucle de drenado.
 *
 * REGLAS que respeta:
 *  - PERSISTIR ANTES de pintar: la fila es durable en cuanto se registra (aunque
 *    la app muera acto seguido, sobrevive y se drena al reabrir).
 *  - No borrar hasta confirmar: el drenado marca `uploaded`; la poda real la hace
 *    `reconcile` cuando el servidor devuelve ese id.
 *  - Aislar fallos: un rechazo PERMANENTE (RLS/CHECK) marca esa fila `failed` y el
 *    bucle CONTINÚA con las demás; un fallo TRANSITORIO (red) para el drenado (se
 *    reintenta al reconectar o en el siguiente registro).
 */
export type EventQueueApi = {
  /** Filas a superponer en timeline/marcador (pending + uploaded, sin failed). */
  overlay: QueuedMatchEventRow[];
  pendingCount: number;
  failedCount: number;
  failed: QueuedEvent[];
  /** Registrar un evento ya construido (uuid + reloj congelados en el toque). */
  enqueue: (row: QueuedMatchEventRow) => Promise<void>;
  /** Reintentar a mano los rechazados. */
  retryFailed: () => Promise<void>;
  /** Podar los `uploaded` que el servidor ya devuelve (ida y vuelta confirmado). */
  reconcile: (serverIds: Set<string>) => void;
};

export function useEventQueue(eventId: string | null, online: boolean): EventQueueApi {
  const [queue, setQueueState] = useState<EventQueue>(EMPTY_QUEUE);
  const queueRef = useRef<EventQueue>(EMPTY_QUEUE);
  const drainingRef = useRef(false);

  // Único punto que muta el estado + el ref (siempre desde callbacks/efectos,
  // nunca en render → válido para el React Compiler).
  const commit = useCallback((next: EventQueue) => {
    queueRef.current = next;
    setQueueState(next);
  }, []);

  // Carga la cola persistida al entrar en el partido (o al cambiar de partido).
  useEffect(() => {
    let active = true;
    (async () => {
      const q = eventId ? await loadQueue(eventId) : EMPTY_QUEUE;
      if (active) commit(q);
    })();
    return () => {
      active = false;
    };
  }, [eventId, commit]);

  // Drena las pendientes EN ORDEN con upsert idempotente. Persiste tras CADA fila
  // (si la app muere a mitad, lo ya subido queda marcado). Comprueba la red fresca.
  const drain = useCallback(async () => {
    if (!eventId || drainingRef.current) return;
    if (!(await getIsOnline())) return;
    drainingRef.current = true;
    try {
      let working = queueRef.current;
      for (const entry of pendingForDrain(working)) {
        const out = await upsertMatchEventFromClient(supabase, entry.row);
        const result: DrainResult = out.ok
          ? { kind: 'ok' }
          : out.permanent
            ? { kind: 'permanent', error: out.error }
            : { kind: 'transient' };
        working = applyDrainResult(working, entry.row.id, result);
        await saveQueue(eventId, working);
        commit(working);
        // Red caída (transitorio): no seguir martilleando; se reintenta luego.
        if (!out.ok && !out.permanent) break;
      }
    } finally {
      drainingRef.current = false;
    }
  }, [eventId, commit]);

  // Al RECONECTAR (o al montar con red) intenta drenar lo que quedó pendiente.
  useEffect(() => {
    if (online) void drain();
  }, [online, drain]);

  const enqueue = useCallback(
    async (row: QueuedMatchEventRow) => {
      if (!eventId) return;
      const next = enqueueEvent(queueRef.current, row);
      await saveQueue(eventId, next); // PERSISTIR antes de pintar (durabilidad)
      commit(next); // optimista: aparece al instante en el timeline/marcador
      void drain(); // subir ya si hay red
    },
    [eventId, commit, drain],
  );

  const retryFailed = useCallback(async () => {
    if (!eventId) return;
    const next = resetFailedToPending(queueRef.current);
    await saveQueue(eventId, next);
    commit(next);
    void drain();
  }, [eventId, commit, drain]);

  const reconcile = useCallback(
    (serverIds: Set<string>) => {
      if (!eventId) return;
      const cur = queueRef.current;
      const next = pruneConfirmed(cur, serverIds);
      if (next.length === cur.length) return; // nada confirmado nuevo
      void saveQueue(eventId, next);
      commit(next);
    },
    [eventId, commit],
  );

  return useMemo<EventQueueApi>(
    () => ({
      overlay: overlayRows(queue),
      pendingCount: countPending(queue),
      failedCount: countFailed(queue),
      failed: failedEntries(queue),
      enqueue,
      retryFailed,
      reconcile,
    }),
    [queue, enqueue, retryFailed, reconcile],
  );
}
