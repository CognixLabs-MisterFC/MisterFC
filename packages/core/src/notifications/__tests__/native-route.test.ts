import { describe, expect, it } from 'vitest';
import {
  audienceMark,
  declaredAudience,
  isFamilyAudienceNotification,
  nativeHrefForNotification,
  nativeTargetForNotification,
  NOTIFICATION_AUDIENCE_KEY,
  resourceIdForNotification,
} from '../native-route';

// Pantallas que existen en cada área nativa (espejo de apps/native nav/config:
// AREA_TABS + AREA_MENU). Se inyectan al mapper como haría la app.
const FAMILY = new Set([
  'calendario', 'directos', 'mensajes', 'mi-equipo', 'convocatorias',
  'mi-ficha', 'mi-informe', 'seguidores', 'anuncios', 'novedades', 'perfil',
  'asistencia',
]);
const DIRECTION = new Set([
  'equipos', 'directos', 'mensajes', 'inicio-direccion', 'dashboard',
  'calendario', 'jugadores', 'cuerpo-tecnico', 'supresiones', 'anuncios',
  'novedades', 'perfil',
  // 18-F3c — la lanzadera de calendario tiene 3 destinos dedicados (href:null).
  'calendario-proximos', 'calendario-temporada', 'calendario-festivos',
]);
const SPECTATOR = new Set(['directos', 'estadisticas', 'perfil']);

describe('nativeHrefForNotification (deep link O2-4)', () => {
  it('new_message con conversation_id → pantalla + id', () => {
    expect(
      nativeHrefForNotification(
        'new_message',
        { type: 'new_message', conversation_id: 'c1' },
        'family',
        FAMILY,
      ),
    ).toEqual({ pathname: '/family/mensajes', params: { id: 'c1' } });
  });

  it('SIN resource_id → destino del type sin id (tolerante, no peta)', () => {
    expect(
      nativeHrefForNotification('new_message', { type: 'new_message' }, 'family', FAMILY),
    ).toEqual({ pathname: '/family/mensajes' });
  });

  it('data null → destino del type sin id', () => {
    expect(
      nativeHrefForNotification('new_announcement', null, 'family', FAMILY),
    ).toEqual({ pathname: '/family/anuncios' });
  });

  it('new_announcement usa announcement_id', () => {
    expect(
      nativeHrefForNotification(
        'new_announcement',
        { type: 'new_announcement', announcement_id: 'a9' },
        'family',
        FAMILY,
      ),
    ).toEqual({ pathname: '/family/anuncios', params: { id: 'a9' } });
  });

  it('goal → directos (existe en TODAS las áreas, incl. spectator)', () => {
    expect(
      nativeHrefForNotification(
        'goal',
        { type: 'goal', event_id: 'e5', team_id: 't1' },
        'spectator',
        SPECTATOR,
      ),
    ).toEqual({ pathname: '/spectator/directos', params: { id: 'e5' } });
  });

  it('pantalla NO disponible en el área → Inicio del área, no error', () => {
    // Una pantalla que NO está en el set del área → Inicio. (El set DIRECTION de
    // arriba es un espejo PARCIAL y algo viejo del config: en la app real
    // 'convocatorias' sí existe en dirección, vía DIRECTION_HIDDEN. Lo que este
    // test fija es la tolerancia del mapper, no el catálogo de dirección; el
    // espejo fiel y completo está en los sets del bloque PUSH-ÁREA, abajo.)
    expect(
      nativeHrefForNotification(
        'callup_published',
        { type: 'callup_published', event_id: 'e1' },
        'direction',
        DIRECTION,
      ),
    ).toEqual({ pathname: '/direction' });
  });

  it('spectator sin mensajes → new_message cae en Inicio', () => {
    expect(
      nativeHrefForNotification(
        'new_message',
        { type: 'new_message', conversation_id: 'c1' },
        'spectator',
        SPECTATOR,
      ),
    ).toEqual({ pathname: '/spectator' });
  });

  it('tipos de calendario → calendario sin id (la web tampoco pasa id)', () => {
    for (const t of [
      'event_updated', 'training_cancelled', 'training_reinstated',
      'training_approval_requested', 'training_approved', 'training_rejected',
      'player_promoted',
    ]) {
      expect(
        nativeHrefForNotification(t, { type: t, event_id: 'e1' }, 'family', FAMILY),
      ).toEqual({ pathname: '/family/calendario' });
    }
  });

  it('18-F3c dirección: training_approval_requested → festivos (donde se aprueba)', () => {
    // El push "entreno en festivo por aprobar" le llega al director; debe aterrizar en
    // la pantalla de festivos, no en la lanzadera. Sin id: festivos es un listado y este
    // type no tiene clave de id (event_id se ignora; solo resource_id daría id).
    expect(
      nativeHrefForNotification(
        'training_approval_requested',
        { type: 'training_approval_requested', event_id: 'e1' },
        'direction',
        DIRECTION,
      ),
    ).toEqual({ pathname: '/direction/calendario-festivos' });
  });

  it('18-F3c: el override es SOLO dirección+ese type; el resto de calendario → lanzadera', () => {
    // Los otros seis siguen en 'calendario' (lanzadera en dirección).
    for (const t of [
      'event_updated', 'training_cancelled', 'training_reinstated',
      'training_approved', 'training_rejected', 'player_promoted',
    ]) {
      expect(
        nativeHrefForNotification(t, { type: t }, 'direction', DIRECTION),
      ).toEqual({ pathname: '/direction/calendario' });
    }
    // Y familia NO se pisa: para ese mismo type sigue en su calendario.
    expect(
      nativeHrefForNotification(
        'training_approval_requested',
        { type: 'training_approval_requested' },
        'family',
        FAMILY,
      ),
    ).toEqual({ pathname: '/family/calendario' });
  });

  it('type sin pantalla nativa (play_approved, exercise_rejected) → Inicio', () => {
    expect(
      nativeHrefForNotification('play_approved', { play_id: 'p1' }, 'family', FAMILY),
    ).toEqual({ pathname: '/family' });
    expect(
      nativeHrefForNotification('exercise_rejected', { exercise_id: 'x1' }, 'family', FAMILY),
    ).toEqual({ pathname: '/family' });
  });

  it('type desconocido → Inicio del área', () => {
    expect(
      nativeHrefForNotification('cosa_rara', { type: 'cosa_rara' }, 'staff', new Set(['mensajes'])),
    ).toEqual({ pathname: '/staff' });
  });

  it('fallback a resource_id cuando no hay clave específica del type', () => {
    // match_callup_reminder sin event_id pero con resource_id (del deep_link UUID).
    expect(
      nativeHrefForNotification(
        'match_callup_reminder',
        { type: 'match_callup_reminder', resource_id: 'uuid-9' },
        'family',
        FAMILY,
      ),
    ).toEqual({ pathname: '/family/convocatorias', params: { id: 'uuid-9' } });
  });
});

describe('resourceIdForNotification', () => {
  it('prioriza la clave específica del type sobre resource_id', () => {
    expect(
      resourceIdForNotification('new_message', {
        conversation_id: 'c1',
        resource_id: 'r9',
      }),
    ).toBe('c1');
  });

  it('cae en resource_id si no está la clave del type', () => {
    expect(
      resourceIdForNotification('new_message', { resource_id: 'r9' }),
    ).toBe('r9');
  });

  it('undefined si no hay ni clave ni resource_id, y con data null', () => {
    expect(resourceIdForNotification('new_message', {})).toBeUndefined();
    expect(resourceIdForNotification('new_message', null)).toBeUndefined();
    // type de calendario: sin clave de id definida → resource_id o undefined.
    expect(resourceIdForNotification('training_cancelled', { event_id: 'e1' })).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUSH-ÁREA — el aviso sobre un hijo abre familia aunque el hogar sea otro.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Espejo COMPLETO de las pantallas de cada área (apps/native nav/config:
 * AREA_TABS + allMenuFiles, que incluye los bloques *_HIDDEN). Completo a
 * propósito: el set DIRECTION de arriba es parcial y por eso dice que dirección
 * no tiene 'convocatorias' cuando sí la tiene. Aquí eso importa: el caso que
 * arregla esta pieza es justo un director que aterriza en LA CONVOCATORIA
 * EQUIVOCADA (la lista club-wide de dirección, en solo lectura), no en el Inicio.
 */
const FAMILY_REAL: ReadonlySet<string> = new Set([
  'anuncios', 'calendario', 'convocatoria', 'convocatorias', 'cuerpo-tecnico',
  'directo', 'directos', 'entrenamiento', 'entrenamientos', 'estadisticas',
  'gestion', 'index', 'jugada', 'jugadas', 'mensaje', 'mensaje-equipo',
  'mensaje-nuevo', 'mensajes', 'mi-equipo', 'mi-ficha', 'mi-informe',
  'novedades', 'perfil', 'plantilla', 'seguidores', 'sesion',
]);
const DIRECTION_REAL: ReadonlySet<string> = new Set([
  'anuncios', 'calendario', 'calendario-festivos', 'calendario-proximos',
  'calendario-temporada', 'coach', 'convocatoria', 'convocatorias',
  'cuerpo-tecnico', 'dashboard', 'directo', 'directos', 'entrenamiento',
  'entrenamientos', 'equipo', 'equipo-calendario', 'equipo-cuerpo-tecnico',
  'equipo-estadisticas', 'equipo-plantilla', 'equipos', 'index',
  'inicio-direccion', 'invitaciones-equipos', 'jugador', 'jugadores', 'mensaje',
  'mensaje-equipo', 'mensaje-nuevo', 'mensaje-staff', 'mensajes', 'novedades',
  'pendientes-asistencia', 'pendientes-convocatoria', 'pendientes-informes',
  'pendientes-informes-jugadores', 'pendientes-invitaciones', 'pendientes-sesion',
  'perfil', 'sesion', 'supresiones',
]);
const STAFF_REAL: ReadonlySet<string> = new Set([
  'alineacion', 'anuncios', 'asistencia', 'asistencia-sesion', 'calendario',
  'convocatoria', 'convocatorias', 'cuerpo-tecnico-direccion',
  'cuerpo-tecnico-ligero', 'directo', 'directos', 'entrenos-sin-lista',
  'entrenos-sin-sesion', 'equipo', 'estadisticas-equipo', 'index', 'informes',
  'informes-jugadores', 'jugadores-consulta', 'mensaje', 'mensaje-equipo',
  'mensaje-nuevo', 'mensaje-staff', 'mensajes', 'mis-equipos', 'novedades',
  'perfil', 'post-partido', 'sesion-del-dia', 'sesion-editar',
]);
const SPECTATOR_REAL: ReadonlySet<string> = new Set([
  'directo', 'directos', 'estadisticas', 'index', 'perfil',
]);

/** Un director-tutor: hogar dirección, con hijos vinculados (modo tutor abierto). */
const DIRECTOR_TUTOR = {
  homeArea: 'direction',
  homeScreens: DIRECTION_REAL,
  tutorArea: 'family',
  tutorScreens: FAMILY_REAL,
};
/** El mismo director SIN hijos vinculados: el modo tutor no se le abre. */
const DIRECTOR_SOLO = { homeArea: 'direction', homeScreens: DIRECTION_REAL };

describe('nativeTargetForNotification (área por audiencia del aviso)', () => {
  it('EL CASO: la convocatoria del hijo abre familia, no la lista de dirección', () => {
    expect(
      nativeTargetForNotification(
        'callup_published',
        { type: 'callup_published', event_id: 'e1' },
        DIRECTOR_TUTOR,
      ),
    ).toEqual({ pathname: '/family/convocatorias', params: { id: 'e1' } });
  });

  it('y lo que hacía antes era aterrizar en la convocatoria de dirección', () => {
    // No es el Inicio: 'convocatorias' SÍ existe en dirección (DIRECTION_HIDDEN),
    // y es la lista club-wide en SOLO LECTURA. Por eso el fallo no se veía como
    // un rebote, sino como "esta no es la convocatoria de mi hija".
    expect(
      nativeHrefForNotification(
        'callup_published',
        { type: 'callup_published', event_id: 'e1' },
        'direction',
        DIRECTION_REAL,
      ),
    ).toEqual({ pathname: '/direction/convocatorias', params: { id: 'e1' } });
  });

  it('sin hijos vinculados NO se cambia de área (la puerta es hasLinkedPlayers)', () => {
    expect(
      nativeTargetForNotification(
        'callup_published',
        { type: 'callup_published', event_id: 'e1' },
        DIRECTOR_SOLO,
      ),
    ).toEqual({ pathname: '/direction/convocatorias', params: { id: 'e1' } });
  });

  it('un ENTRENADOR que además es padre: mismo arreglo (no es cosa de directores)', () => {
    expect(
      nativeTargetForNotification(
        'development_report_published',
        { type: 'development_report_published', development_report_id: 'r7' },
        {
          homeArea: 'staff',
          homeScreens: STAFF_REAL,
          tutorArea: 'family',
          tutorScreens: FAMILY_REAL,
        },
      ),
    ).toEqual({ pathname: '/family/mi-informe', params: { id: 'r7' } });
  });

  it('quien YA vive en familia no nota nada', () => {
    expect(
      nativeTargetForNotification(
        'callup_published',
        { type: 'callup_published', event_id: 'e1' },
        {
          homeArea: 'family',
          homeScreens: FAMILY_REAL,
          tutorArea: 'family',
          tutorScreens: FAMILY_REAL,
        },
      ),
    ).toEqual({ pathname: '/family/convocatorias', params: { id: 'e1' } });
  });

  it('los demás avisos de audiencia familia llegan a SU pantalla de familia', () => {
    expect(
      nativeTargetForNotification('play_published', { type: 'play_published', play_id: 'p1' }, DIRECTOR_TUTOR),
    ).toEqual({ pathname: '/family/mi-equipo', params: { id: 'p1' } });
    expect(
      nativeTargetForNotification('player_promoted', { type: 'player_promoted' }, DIRECTOR_TUTOR),
    ).toEqual({ pathname: '/family/calendario' });
    expect(
      nativeTargetForNotification('event_updated', { type: 'event_updated' }, DIRECTOR_TUTOR),
    ).toEqual({ pathname: '/family/calendario' });
    expect(
      nativeTargetForNotification('match_callup_reminder', { type: 'match_callup_reminder', event_id: 'e2' }, DIRECTOR_TUTOR),
    ).toEqual({ pathname: '/family/convocatorias', params: { id: 'e2' } });
  });

  it('el trabajo del director sigue en dirección (el festivo NO se va a familia)', () => {
    expect(
      nativeTargetForNotification(
        'training_approval_requested',
        { type: 'training_approval_requested', event_id: 'e1' },
        DIRECTOR_TUTOR,
      ),
    ).toEqual({ pathname: '/direction/calendario-festivos' });
  });

  it('un aviso de staff se queda en staff aunque el entrenador tenga hijos', () => {
    expect(
      nativeTargetForNotification(
        'attendance_pending_reminder',
        { type: 'attendance_pending_reminder', event_id: 'e1' },
        {
          homeArea: 'staff',
          homeScreens: STAFF_REAL,
          tutorArea: 'family',
          tutorScreens: FAMILY_REAL,
        },
      ),
    ).toEqual({ pathname: '/staff/asistencia', params: { id: 'e1' } });
  });

  it('los MIXTOS siguen en el hogar: es el contrato de esta pieza, no un olvido', () => {
    // new_message (coach↔familia), new_announcement (club-wide vs team-bound),
    // training_cancelled/reinstated (festivo → staff Y familia), training_reminder
    // (todo el equipo) e image_consent_revoked (dirección Y staff) llegan a dos
    // audiencias con el mismo nombre. Se resuelven marcando la audiencia en el
    // `data` del emisor, en su propio PR. Hasta entonces: como hoy.
    expect(
      nativeTargetForNotification('new_message', { type: 'new_message', conversation_id: 'c1' }, DIRECTOR_TUTOR),
    ).toEqual({ pathname: '/direction/mensajes', params: { id: 'c1' } });
    expect(
      nativeTargetForNotification('new_announcement', { type: 'new_announcement', announcement_id: 'a1' }, DIRECTOR_TUTOR),
    ).toEqual({ pathname: '/direction/anuncios', params: { id: 'a1' } });
    for (const t of ['training_cancelled', 'training_reinstated', 'training_reminder']) {
      expect(nativeTargetForNotification(t, { type: t }, DIRECTOR_TUTOR).pathname).toMatch(/^\/direction/);
    }
    expect(
      nativeTargetForNotification('image_consent_revoked', { type: 'image_consent_revoked' }, DIRECTOR_TUTOR),
    ).toEqual({ pathname: '/direction' });
  });

  it('audiencia familia SIN pantalla en familia → no se mueve de área por nada', () => {
    // tutor_unlinked y subscription_expiring no tienen pantalla nativa: cambiar de
    // área solo dejaría al director en el Inicio de FAMILIA en vez del suyo. Se
    // queda donde estaba hasta que exista el destino.
    expect(
      nativeTargetForNotification('tutor_unlinked', { type: 'tutor_unlinked' }, DIRECTOR_TUTOR),
    ).toEqual({ pathname: '/direction' });
    expect(
      nativeTargetForNotification('subscription_expiring', { type: 'subscription_expiring' }, DIRECTOR_TUTOR),
    ).toEqual({ pathname: '/direction' });
  });

  it('el seguidor no tiene lado familia: su push no se mueve', () => {
    expect(
      nativeTargetForNotification(
        'goal',
        { type: 'goal', event_id: 'e1' },
        { homeArea: 'spectator', homeScreens: SPECTATOR_REAL },
      ),
    ).toEqual({ pathname: '/spectator/directos', params: { id: 'e1' } });
  });

  it('tolerante: data null y type desconocido → Inicio del hogar, nunca error', () => {
    expect(nativeTargetForNotification('callup_published', null, DIRECTOR_TUTOR)).toEqual({
      pathname: '/family/convocatorias',
    });
    expect(
      nativeTargetForNotification('type_que_no_existe', { type: 'x' }, DIRECTOR_TUTOR),
    ).toEqual({ pathname: '/direction' });
  });

  it('isFamilyAudienceNotification: ante la duda, NO es de familia', () => {
    expect(isFamilyAudienceNotification('callup_published')).toBe(true);
    expect(isFamilyAudienceNotification('development_report_published')).toBe(true);
    // Mixtos y desconocidos responden false: el hogar es el comportamiento de siempre.
    expect(isFamilyAudienceNotification('new_message')).toBe(false);
    expect(isFamilyAudienceNotification('training_reminder')).toBe(false);
    expect(isFamilyAudienceNotification('')).toBe(false);
    expect(isFamilyAudienceNotification('inventado')).toBe(false);
  });
});

describe('marca de audiencia del emisor (mixtos)', () => {
  it('new_message marcado como familia abre familia, y sin marca no', () => {
    // El mismo type, los mismos ids: lo único que cambia es quién lo manda.
    expect(
      nativeTargetForNotification(
        'new_message',
        { type: 'new_message', conversation_id: 'c1', ...audienceMark('family') },
        DIRECTOR_TUTOR,
      ),
    ).toEqual({ pathname: '/family/mensajes', params: { id: 'c1' } });
    expect(
      nativeTargetForNotification(
        'new_message',
        { type: 'new_message', conversation_id: 'c1' },
        DIRECTOR_TUTOR,
      ),
    ).toEqual({ pathname: '/direction/mensajes', params: { id: 'c1' } });
  });

  it('LA DECISIÓN DE JOSE: gana staff — el entrenador que es padre de su equipo', () => {
    // El festivo cancela el entreno que él dirige. Está en los dos grupos y el
    // emisor ya lo ha puesto en el de staff; la marca tiene que PODER decir "este
    // no es de familia" aunque su hogar sea otro.
    const entrenadorPadre = {
      homeArea: 'staff',
      homeScreens: STAFF_REAL,
      tutorArea: 'family',
      tutorScreens: FAMILY_REAL,
    };
    expect(
      nativeTargetForNotification(
        'training_cancelled',
        { type: 'training_cancelled', ...audienceMark('staff') },
        entrenadorPadre,
      ),
    ).toEqual({ pathname: '/staff/calendario' });
    // Y el padre que NO entrena a ese equipo recibe la otra mitad del envío.
    expect(
      nativeTargetForNotification(
        'training_cancelled',
        { type: 'training_cancelled', ...audienceMark('family') },
        DIRECTOR_TUTOR,
      ),
    ).toEqual({ pathname: '/family/calendario' });
  });

  it('la marca GANA a la tabla por tipo, en los dos sentidos', () => {
    // callup_published está en la tabla como familia; marcado 'staff' NO se mueve.
    expect(
      nativeTargetForNotification(
        'callup_published',
        { type: 'callup_published', event_id: 'e1', ...audienceMark('staff') },
        DIRECTOR_TUTOR,
      ),
    ).toEqual({ pathname: '/direction/convocatorias', params: { id: 'e1' } });
    // training_reminder NO está en la tabla; marcado 'family' sí se mueve… salvo
    // que no tiene pantalla en familia, así que se queda (4ª condición).
    expect(
      nativeTargetForNotification(
        'training_reminder',
        { type: 'training_reminder', ...audienceMark('family') },
        DIRECTOR_TUTOR,
      ),
    ).toEqual({ pathname: '/direction' });
  });

  it('una marca desconocida o vacía no rompe: se cae a la tabla por tipo', () => {
    expect(
      nativeTargetForNotification(
        'callup_published',
        { type: 'callup_published', event_id: 'e1', audience: '' },
        DIRECTOR_TUTOR,
      ),
    ).toEqual({ pathname: '/family/convocatorias', params: { id: 'e1' } });
    // Un valor que no es ninguna audiencia conocida NO es familia: al hogar.
    expect(
      nativeTargetForNotification(
        'callup_published',
        { type: 'callup_published', event_id: 'e1', audience: 'marciano' },
        DIRECTOR_TUTOR,
      ),
    ).toEqual({ pathname: '/direction/convocatorias', params: { id: 'e1' } });
  });

  it('declaredAudience lee solo cadenas no vacías', () => {
    expect(declaredAudience({ audience: 'family' })).toBe('family');
    expect(declaredAudience({ audience: '' })).toBeNull();
    expect(declaredAudience({ audience: 3 })).toBeNull();
    expect(declaredAudience(null)).toBeNull();
    expect(declaredAudience({})).toBeNull();
  });

  it('audienceMark escribe la clave que el lector espera', () => {
    // Si alguien renombra la clave en un lado y no en el otro, el fallo sería mudo.
    expect(audienceMark('family')).toEqual({ [NOTIFICATION_AUDIENCE_KEY]: 'family' });
    expect(NOTIFICATION_AUDIENCE_KEY).toBe('audience');
  });
});
