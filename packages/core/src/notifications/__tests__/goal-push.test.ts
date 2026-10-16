import { describe, it, expect } from 'vitest';
import {
  formatGoalPush,
  goalDedupeBasePrefix,
  goalDedupeLikePrefix,
  goalPushRequestDecision,
  resolveGoalRecipients,
} from '../goal-push';

describe('formatGoalPush', () => {
  it('formats "Gol" + "{Local N - M Visitante}" when OUR team scores', () => {
    expect(
      formatGoalPush({ teamName: 'Fonteta', opponentName: 'Valencia', own: 1, rival: 0 }),
    ).toEqual({ title: 'Gol', body: 'Fonteta 1 - 0 Valencia' });
  });

  it('reflects a RIVAL goal in the updated scoreline (still emits "Gol")', () => {
    // Marca el rival → el marcador nuevo es 1 - 1; el título no distingue bando.
    expect(
      formatGoalPush({ teamName: 'Fonteta', opponentName: 'Valencia', own: 1, rival: 1 }),
    ).toEqual({ title: 'Gol', body: 'Fonteta 1 - 1 Valencia' });
  });

  it('omits the rival cleanly when there is no opponent name', () => {
    expect(formatGoalPush({ teamName: 'Fonteta', opponentName: null, own: 2, rival: 1 })).toEqual({
      title: 'Gol',
      body: 'Fonteta 2 - 1',
    });
  });

  it('trims stray whitespace in names', () => {
    const m = formatGoalPush({
      teamName: '  Fonteta ',
      opponentName: '  Levante  ',
      own: 3,
      rival: 2,
    });
    expect(m.title).toBe('Gol');
    expect(m.body).toBe('Fonteta 3 - 2 Levante');
  });
});

describe('resolveGoalRecipients', () => {
  it('excludes the recorder, dedupes and drops empties', () => {
    const recipients = resolveGoalRecipients(['u1', 'u2', 'u1', null, undefined, 'rec', ''], 'rec');
    expect(recipients).toEqual(['u1', 'u2']);
  });

  it('returns everyone when the recorder does not follow', () => {
    expect(resolveGoalRecipients(['u1', 'u2'], 'rec')).toEqual(['u1', 'u2']);
  });

  it('returns empty when the only follower is the recorder', () => {
    expect(resolveGoalRecipients(['rec'], 'rec')).toEqual([]);
  });
});

describe('la clave de dedupe del gol · el formato que comparten SQL y TS', () => {
  const GOL = '90f00000-0000-4000-8000-000000000001';

  // Literal a propósito, no construido con la propia función: lo que tiene que
  // cuadrar es con lo que el trigger `notify_goal` concatena en SQL, y eso un test
  // de vitest no lo puede leer. La otra mitad de esta afirmación está en el pgTAP
  // `el_gol_avisa_venga_de_donde_venga.sql`, que compara contra la clave COMPLETA.
  it('la base es la que el trigger escribe en SQL', () => {
    expect(goalDedupeBasePrefix(GOL)).toBe('goal:90f00000-0000-4000-8000-000000000001');
  });

  it('el prefijo de búsqueda acaba en dos puntos', () => {
    expect(goalDedupeLikePrefix(GOL)).toBe('goal:90f00000-0000-4000-8000-000000000001:');
  });

  // El motivo de que los dos puntos estén ahí. Con un `like` sin ellos, un gol cuyo
  // id sea prefijo de otro arrastraría las filas del otro — y el envío eager mandaría
  // un push que no le toca.
  it('no arrastra las filas de otro gol cuyo id empiece igual', () => {
    const corto = goalDedupeLikePrefix('abc');
    const clavesDeOtroGol = ['goal:abcdef:user-1:push', 'goal:abc9:user-1:push'];
    for (const clave of clavesDeOtroGol) {
      expect(clave.startsWith(corto)).toBe(false);
    }
    expect('goal:abc:user-1:push'.startsWith(corto)).toBe(true);
  });

  it('la base es prefijo del prefijo de búsqueda (no divergen)', () => {
    expect(goalDedupeLikePrefix(GOL).startsWith(goalDedupeBasePrefix(GOL))).toBe(true);
  });
});

describe('goalPushRequestDecision · quién puede disparar el envío de un gol', () => {
  const YO = 'aa000000-0000-4000-8000-000000000001';
  const OTRO = 'bb000000-0000-4000-8000-000000000002';

  it('mi gol se manda', () => {
    expect(
      goalPushRequestDecision({
        row: { created_by: YO, type: 'goal' },
        callerProfileId: YO,
      }),
    ).toBe('send');
  });

  it('un penalti MARCADO mío también', () => {
    expect(
      goalPushRequestDecision({
        row: { created_by: YO, type: 'penalty', outcome: 'scored' },
        callerProfileId: YO,
      }),
    ).toBe('send');
  });

  it('un penalti FALLADO mío no tiene nada que mandar', () => {
    expect(
      goalPushRequestDecision({
        row: { created_by: YO, type: 'penalty', outcome: 'missed' },
        callerProfileId: YO,
      }),
    ).toBe('not_a_goal');
  });

  it('mi tarjeta tampoco', () => {
    expect(
      goalPushRequestDecision({
        row: { created_by: YO, type: 'yellow_card' },
        callerProfileId: YO,
      }),
    ).toBe('not_a_goal');
  });

  // El gate. Es lo único de esta pieza que separa «avisar a las familias de MI equipo»
  // de «disparar el aviso de un partido ajeno».
  it('el gol de OTRO no se manda', () => {
    expect(
      goalPushRequestDecision({
        row: { created_by: OTRO, type: 'goal' },
        callerProfileId: YO,
      }),
    ).toBe('forbidden');
  });

  // Con la RLS delante y el JWT del usuario, «no existe» y «existe y no es tuyo» llegan
  // igual al handler: como null. Las dos son forbidden, y no se inventa una diferencia
  // que el servidor no puede saber.
  it('una fila que no se ve es forbidden, no un 404 que confirma que existe', () => {
    expect(goalPushRequestDecision({ row: null, callerProfileId: YO })).toBe('forbidden');
  });

  it('sin usuario no se manda nada (ni con la fila delante)', () => {
    expect(
      goalPushRequestDecision({
        row: { created_by: YO, type: 'goal' },
        callerProfileId: '',
      }),
    ).toBe('forbidden');
  });

  // EL ORDEN, y no es cosmética: si el tipo se comprobara antes que la propiedad, la
  // respuesta a una fila ajena cambiaría según lo que esa fila FUESE —`not_a_goal` para
  // una tarjeta, `forbidden` para un gol—, y eso cuenta algo de una fila que quien
  // pregunta no puede ver.
  it('la tarjeta de OTRO es forbidden, no not_a_goal: no se filtra qué era', () => {
    expect(
      goalPushRequestDecision({
        row: { created_by: OTRO, type: 'yellow_card' },
        callerProfileId: YO,
      }),
    ).toBe('forbidden');
  });
});
