import { useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import {
  getClubPartnerRowsFromClient,
  signClubPartnerLogosFromClient,
  groupPartnersByKind,
  clubScopedCacheKey,
  PARTNER_KINDS,
  type ClubPartnerRow,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { useCached } from '@/data/use-cached';
import { useIsOnline } from '@/data/connectivity';
import { reportDataError } from '@/lib/report-error';
import { useTranslations } from '@/locale/provider';

/**
 * V-3 — PATROCINADORES Y COLABORADORES del club, en los CUATRO inicios de la app:
 * familia (que cubre al jugador), cuerpo técnico, dirección y seguidor. Un solo
 * componente para los cuatro; la pantalla solo le pasa el club.
 *
 * SOLO LECTURA. Se gestionan únicamente en la web (V-4), así que aquí no hay ninguna
 * escritura y por eso `club-partners` no aparece en `WRITE_INVALIDATIONS`: no hay
 * ninguna acción de la app que los deje obsoletos. Un cambio hecho en la web llega
 * por el refetch-al-enfocar de `useCached`, como al resto de pantallas.
 *
 * ── POR QUÉ LA LECTURA VA EN DOS PASOS ──────────────────────────────────────
 * Las FILAS se cachean (`useCached` las guarda en disco para que el inicio funcione
 * sin conexión). Las URLs FIRMADAS no: el bucket es privado y una firma dura una
 * hora, así que una firma guardada en la caché de ayer es un logo roto. Por eso la
 * fila guarda `logoPath` y la firma se pide APARTE, fuera de la caché y solo online
 * — exactamente lo que hace `PlayerAvatar` con la foto del jugador.
 *
 * Sin conexión, entonces, se ven los nombres y las líneas de texto (que sí están
 * cacheados) con la inicial en lugar del logo. Un socio sin logo sigue siendo un
 * socio; desaparecer sería peor, porque el club prometió enseñarlo.
 *
 * Si el club no tiene socios, esto NO PINTA NADA: ni rótulo, ni hueco, ni "no hay
 * patrocinadores". Un inicio no es el sitio para anunciar una ausencia.
 */
export function ClubPartnersSection({ clubId }: { clubId: string | null }) {
  const t = useTranslations('');
  const online = useIsOnline();

  const { data } = useCached<ClubPartnerRow[]>(
    clubScopedCacheKey('club-partners', clubId ?? 'none'),
    (sb) =>
      clubId
        ? getClubPartnerRowsFromClient(sb, clubId, (e, paso) =>
            reportDataError(`club-partners-${paso}`, e),
          )
        : Promise.resolve([]),
  );

  const filas = useMemo(() => data ?? [], [data]);

  // Las rutas, en una sola cadena, sirven de dependencia ESTABLE del efecto: el array
  // se recrea en cada render y volvería a firmar sin parar.
  const rutas = useMemo(() => filas.map((f) => f.logoPath).join('|'), [filas]);

  // El resultado va emparejado con las rutas que lo produjeron. Así, si la lista
  // cambia (otro club, un socio nuevo), no se pinta el logo de la anterior mientras
  // llega la firma nueva — el mismo emparejamiento que usa la pantalla de invitación.
  const [firmas, setFirmas] = useState<{ para: string; mapa: Record<string, string> } | null>(
    null,
  );

  useEffect(() => {
    let vivo = true;
    // El setState va DENTRO del callback async y no en el cuerpo del efecto: la regla
    // react-hooks/set-state-in-effect del React Compiler rechaza lo segundo.
    void (async () => {
      let mapa: Record<string, string> = {};
      if (online && rutas.length > 0) {
        const m = await signClubPartnerLogosFromClient(supabase, rutas.split('|'), (e, paso) =>
          reportDataError(`club-partners-${paso}`, e),
        );
        mapa = Object.fromEntries(m);
      }
      if (vivo) setFirmas({ para: rutas, mapa });
    })();
    return () => {
      vivo = false;
    };
  }, [rutas, online]);

  const mapa = firmas && firmas.para === rutas ? firmas.mapa : {};

  // Después de los hooks, nunca antes: una salida temprana arriba cambiaría el número
  // de hooks entre renders.
  if (filas.length === 0) return null;

  const grupos = groupPartnersByKind(filas);

  return (
    <View className="gap-3">
      {PARTNER_KINDS.map((kind) =>
        grupos[kind].length === 0 ? null : (
          <View key={kind} className="gap-2">
            <Text className="pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {t(`partners.${kind}`)}
            </Text>
            {grupos[kind].map((socio) => (
              <PartnerRow key={socio.id} socio={socio} logoUrl={mapa[socio.logoPath] ?? null} />
            ))}
          </View>
        ),
      )}
    </View>
  );
}

/**
 * Una fila de socio. Abre su web con `Linking.openURL`, igual que los documentos
 * legales del perfil y del paywall: es un enlace https normal y corriente, no un
 * módulo nativo nuevo.
 */
function PartnerRow({ socio, logoUrl }: { socio: ClubPartnerRow; logoUrl: string | null }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(socio.url)}
      accessibilityRole="link"
      accessibilityLabel={socio.name}
      className="flex-row items-center gap-3 rounded-2xl border border-zinc-200 p-3 active:opacity-70"
    >
      {logoUrl ? (
        <Image
          source={{ uri: logoUrl }}
          style={{ width: 44, height: 44 }}
          // `contain` y no `cover`: un logo recortado es un logo estropeado, y quien
          // paga tiene derecho a que se le vea entero.
          resizeMode="contain"
        />
      ) : (
        <View className="h-11 w-11 items-center justify-center rounded-lg bg-zinc-100">
          <Text className="text-base font-bold text-zinc-400">
            {socio.name.trim().slice(0, 1).toUpperCase() || '·'}
          </Text>
        </View>
      )}
      <View className="flex-1">
        <Text className="text-sm font-semibold text-[#0F1B2E]" numberOfLines={1}>
          {socio.name}
        </Text>
        {socio.tagline ? (
          <Text className="text-xs text-zinc-400" numberOfLines={1}>
            {socio.tagline}
          </Text>
        ) : null}
      </View>
      <Text className="text-zinc-300">›</Text>
    </Pressable>
  );
}
