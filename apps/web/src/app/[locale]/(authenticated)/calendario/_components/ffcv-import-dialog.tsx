'use client';

/**
 * EL BOTÓN que da de alta los partidos federados, en Calendario.
 *
 * El navegador manda: pulsa una vez y esto hace dieciséis viajes al servidor —uno de
 * preparación y uno por equipo— con la barra avanzando. Es así porque los quince equipos
 * son ~458 llamadas a la FFCV y la FFCV corta a 60 por minuto: siete minutos y medio de
 * suelo, que no caben en una sola invocación (ver `@/lib/ffcv-importar`).
 *
 * Pensado para que cerrar la pestaña a mitad NO sea un problema: el alta SOLO CREA y es
 * idempotente por `codacta`, así que volver a pulsar sigue donde lo dejó. El aviso de
 * salida está para que nadie se vaya sin saberlo, no porque haga daño.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarPlus, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  describirFallo,
  veredictoDeRespuesta,
  type FfcvFallo,
  type VeredictoEquipo,
} from '@misterfc/core';
import { Button } from '@/components/ui/button';

type EquipoListado = { teamId: string; nombre: string };
type Resumen = {
  teamId: string;
  nombre: string;
  leidos: number;
  creados: number;
  yaEstaban: number;
  actualizados: { acta: string; cambios: string[] }[];
  conHoraDeRelleno: number;
  omitidos: { acta: string; motivo: string }[];
  fallo: FfcvFallo | null;
};
type Fila =
  | { estado: 'pendiente'; equipo: EquipoListado }
  | { estado: 'yendo'; equipo: EquipoListado }
  | { estado: 'hecho'; equipo: EquipoListado; resumen: Resumen }
  | { estado: 'roto'; equipo: EquipoListado; detalle: string };

export function FfcvImportDialog() {
  const t = useTranslations('calendario.ffcv');
  const [open, setOpen] = useState(false);
  const [fase, setFase] = useState<'inicio' | 'preparando' | 'importando' | 'fin'>('inicio');
  const [error, setError] = useState<string | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [saltados, setSaltados] = useState<EquipoListado[]>([]);
  // El mapa de direcciones del viaje de preparación, guardado para poder REINTENTAR sin
  // volver a descargar el catálogo (son 214 KB y 23 páginas de la FFCV).
  const [direcciones, setDirecciones] = useState<Record<string, string>>({});

  const corriendo = fase === 'preparando' || fase === 'importando';

  // Aviso de salida mientras corre. No hay nada que corromper —solo crea—, pero
  // perder siete minutos sin enterarse es mal trato.
  useEffect(() => {
    if (!corriendo) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [corriendo]);

  /**
   * El bucle: un viaje por equipo, en serie. Separado de `importar` porque el botón de
   * reintento lo vuelve a llamar con SOLO los que fallaron — y repetir los quince para
   * recuperar cinco son veinticinco minutos tirados.
   *
   * En serie a propósito: en paralelo los viajes se comerían el límite de ritmo de la
   * FFCV los unos a los otros y todos irían más lentos.
   */
  const correr = useCallback(
    async (cuales: EquipoListado[], mapa: Record<string, string>) => {
      for (const equipo of cuales) {
        setFilas((previas) =>
          previas.map((f) => (f.equipo.teamId === equipo.teamId ? { estado: 'yendo', equipo } : f)),
        );
        let veredicto: VeredictoEquipo<Resumen>;
        try {
          const res = await fetch('/api/ffcv/importar-equipo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamId: equipo.teamId, direcciones: mapa }),
          });
          // `res.text()` y NO `res.json()`: el segundo LANZA cuando el cuerpo no es JSON
          // —la página de error de Vercel al matar la invocación por tiempo lo es— y eso
          // acababa en el catch de «no hay red», que es mentira: conectó perfectamente.
          veredicto = veredictoDeRespuesta<Resumen>(res.status, await res.text());
        } catch {
          // Aquí sí: el fetch no llegó a contestar. Esto es la red de verdad.
          veredicto = { ok: false, clave: 'red' };
        }
        setFilas((previas) =>
          previas.map((f) => {
            if (f.equipo.teamId !== equipo.teamId) return f;
            if (veredicto.ok) return { estado: 'hecho', equipo, resumen: veredicto.resumen };
            return {
              estado: 'roto',
              equipo,
              detalle:
                'fallo' in veredicto
                  ? describirFallo(veredicto.fallo)
                  : t(`errors.${veredicto.clave}`, { status: veredicto.status ?? 0 }),
            };
          }),
        );
      }
      setFase('fin');
    },
    [t],
  );

  const importar = useCallback(async () => {
    setError(null);
    setFilas([]);
    setSaltados([]);
    setFase('preparando');

    let equipos: EquipoListado[] = [];
    let direccionesLeidas: Record<string, string> = {};
    try {
      const res = await fetch('/api/ffcv/preparar', { method: 'POST' });
      const cuerpo = (await res.json()) as {
        ok?: boolean;
        error?: string;
        equipos?: EquipoListado[];
        sinUbicacion?: EquipoListado[];
        sinVincular?: EquipoListado[];
        direcciones?: Record<string, string>;
      };
      if (!res.ok || !cuerpo.ok) {
        setError(t(`errors.${cuerpo.error ?? 'ffcv'}`));
        setFase('inicio');
        return;
      }
      equipos = cuerpo.equipos ?? [];
      direccionesLeidas = cuerpo.direcciones ?? {};
      setDirecciones(direccionesLeidas);
      setSaltados([...(cuerpo.sinUbicacion ?? []), ...(cuerpo.sinVincular ?? [])]);
    } catch {
      setError(t('errors.red'));
      setFase('inicio');
      return;
    }

    if (equipos.length === 0) {
      setError(t('sin_equipos'));
      setFase('inicio');
      return;
    }

    setFilas(equipos.map((equipo) => ({ estado: 'pendiente', equipo })));
    setFase('importando');
    await correr(equipos, direccionesLeidas);
  }, [correr, t]);

  /** Vuelve a intentar SOLO los que fallaron, con las direcciones ya descargadas. */
  const reintentar = useCallback(async () => {
    const rotos = filas.flatMap((f) => (f.estado === 'roto' ? [f.equipo] : []));
    if (rotos.length === 0) return;
    // Las filas de los rotos vuelven a «pendiente»; las de los buenos se quedan como
    // están, que es el sentido de esto: no se repite lo que ya salió bien.
    setFilas((previas) =>
      previas.map((f) => (f.estado === 'roto' ? { estado: 'pendiente', equipo: f.equipo } : f)),
    );
    setFase('importando');
    await correr(rotos, direcciones);
  }, [correr, direcciones, filas]);

  const terminadas = filas.filter((f) => f.estado === 'hecho' || f.estado === 'roto').length;
  const creados = filas.reduce((n, f) => (f.estado === 'hecho' ? n + f.resumen.creados : n), 0);
  const yaEstaban = filas.reduce((n, f) => (f.estado === 'hecho' ? n + f.resumen.yaEstaban : n), 0);
  const actualizados = filas.reduce(
    (n, f) => (f.estado === 'hecho' ? n + f.resumen.actualizados.length : n),
    0,
  );
  const conRelleno = filas.reduce(
    (n, f) => (f.estado === 'hecho' ? n + f.resumen.conHoraDeRelleno : n),
    0,
  );
  const rotos = filas.filter((f) => f.estado === 'roto').length;
  const porcentaje = filas.length === 0 ? 0 : Math.round((terminadas / filas.length) * 100);

  return (
    <Dialog
      open={open}
      onOpenChange={(siguiente) => {
        // Mientras corre no se cierra: cerrar desmonta el bucle y lo deja a medias.
        if (corriendo) return;
        setOpen(siguiente);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarPlus className="size-4" aria-hidden />
          <span>{t('trigger')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {fase === 'inicio' && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{t('aviso_tiempo')}</p>
            <p className="text-muted-foreground">{t('aviso_repaso')}</p>
            <p className="text-muted-foreground">{t('aviso_repetible')}</p>
            {error !== null && <p className="text-destructive">{error}</p>}
          </div>
        )}

        {fase === 'preparando' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('preparando')}
          </p>
        )}

        {(fase === 'importando' || fase === 'fin') && (
          <div className="space-y-3">
            <div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={porcentaje}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('progreso_etiqueta')}
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${porcentaje}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('progreso', { hechos: terminadas, total: filas.length })}
              </p>
            </div>

            <ul className="space-y-1 text-sm">
              {filas.map((f) => (
                <li key={f.equipo.teamId} className="flex items-start gap-2">
                  {f.estado === 'yendo' && (
                    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
                  )}
                  {f.estado === 'hecho' && (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  )}
                  {f.estado === 'roto' && (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  )}
                  {f.estado === 'pendiente' && <span className="mt-0.5 size-4 shrink-0" />}
                  <span className="min-w-0">
                    <span className="font-medium">{f.equipo.nombre}</span>
                    {f.estado === 'hecho' && (
                      <span className="text-muted-foreground">
                        {' · '}
                        {t('equipo_hecho', {
                          leidos: f.resumen.leidos,
                          creados: f.resumen.creados,
                          actualizados: f.resumen.actualizados.length,
                          yaEstaban: f.resumen.yaEstaban,
                        })}
                        {f.resumen.conHoraDeRelleno > 0 &&
                          ` · ${t('equipo_relleno', { n: f.resumen.conHoraDeRelleno })}`}
                        {f.resumen.omitidos.length > 0 &&
                          ` · ${t('equipo_omitidos', { n: f.resumen.omitidos.length })}`}
                      </span>
                    )}
                    {f.estado === 'roto' && (
                      <span className="text-destructive">
                        {' · '}
                        {f.detalle}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {fase === 'fin' && (
              <p className="text-sm">
                {t('resumen', { creados, actualizados, yaEstaban })}
                {conRelleno > 0 && ` · ${t('resumen_relleno', { n: conRelleno })}`}
                {rotos > 0 && ` · ${t('resumen_rotos', { n: rotos })}`}
              </p>
            )}

            {saltados.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('saltados', { equipos: saltados.map((e) => e.nombre).join(', ') })}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {fase === 'inicio' && <Button onClick={() => void importar()}>{t('empezar')}</Button>}
          {fase === 'fin' && rotos > 0 && (
            <Button onClick={() => void reintentar()}>{t('reintentar', { n: rotos })}</Button>
          )}
          {fase === 'fin' && (
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('cerrar')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
