import { describe, expect, it } from 'vitest';
import {
  nativeHrefForNotification,
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
    // 'convocatorias' no existe en dirección → cae en Inicio.
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
