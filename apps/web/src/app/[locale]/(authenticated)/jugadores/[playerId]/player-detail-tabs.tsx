'use client';

/**
 * #14 — Envoltorio CLIENT de las pestañas de la ficha del jugador. SOLO coloca en
 * cada TabsContent las secciones que el SERVER ya renderizó (las recibe como
 * props/children); no contiene lógica de datos ni de permisos (esos quedan en
 * page.tsx). La cabecera (foto + nombre) va FUERA, en la página.
 *
 * La pestaña activa se persiste en la URL (?tab=) para que:
 *  - el selector de temporada de PlayerSeasonStats (que navega con ?season=,
 *    preservando el resto de params) NO saque al usuario de "Estadísticas";
 *  - recargar o compartir el enlace abra la misma pestaña (sin flash: el server
 *    siembra la pestaña inicial).
 * El estado local da el cambio instantáneo; la URL solo persiste.
 */

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type PlayerTabKey = 'info' | 'stats' | 'history';

export function PlayerDetailTabs({
  initialTab,
  labels,
  info,
  stats,
  history,
}: {
  initialTab: PlayerTabKey;
  labels: { info: string; stats: string; history: string };
  info: React.ReactNode;
  stats: React.ReactNode;
  history: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [tab, setTab] = useState<PlayerTabKey>(initialTab);

  function onTabChange(value: string) {
    setTab(value as PlayerTabKey);
    const np = new URLSearchParams(params);
    np.set('tab', value);
    // replace (no scroll) para no apilar historial ni saltar al inicio.
    router.replace(`${pathname}?${np.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={tab} onValueChange={onTabChange} className="gap-4">
      <TabsList className="w-full">
        <TabsTrigger value="info">{labels.info}</TabsTrigger>
        <TabsTrigger value="stats">{labels.stats}</TabsTrigger>
        <TabsTrigger value="history">{labels.history}</TabsTrigger>
      </TabsList>
      <TabsContent value="info" className="flex flex-col gap-6">
        {info}
      </TabsContent>
      <TabsContent value="stats" className="flex flex-col gap-6">
        {stats}
      </TabsContent>
      <TabsContent value="history" className="flex flex-col gap-6">
        {history}
      </TabsContent>
    </Tabs>
  );
}
