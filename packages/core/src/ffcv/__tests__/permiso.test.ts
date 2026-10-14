import { describe, it, expect } from 'vitest';
import { permisoImportarFfcv, type ActorFfcv } from '../permiso';

/** El actor que SÍ puede: el caso bueno, para que los «no» se lean por contraste. */
const SUPERADMIN: ActorFfcv = {
  haySesion: true,
  hayClubActivo: true,
  esSuperadmin: true,
};

describe('permisoImportarFfcv — quién puede importar los partidos federados', () => {
  it('el superadmin con club activo puede', () => {
    expect(permisoImportarFfcv(SUPERADMIN)).toEqual({ puede: true });
  });

  it('EL CAMBIO: sin ser superadmin NO puede, haya lo que haya en el club', () => {
    // Esto es la decisión del 14-10-2026. Antes pasaban admin_club y director; hoy
    // la única pregunta es `is_superadmin()`. Con sesión y club activo —es decir,
    // con todo lo demás en orden— la respuesta sigue siendo no.
    expect(permisoImportarFfcv({ ...SUPERADMIN, esSuperadmin: false })).toEqual({
      puede: false,
      motivo: 'no_superadmin',
    });
  });

  it('el motivo distingue 401 de 403: sin sesión no es lo mismo que sin permiso', () => {
    expect(permisoImportarFfcv({ ...SUPERADMIN, haySesion: false })).toEqual({
      puede: false,
      motivo: 'sin_sesion',
    });
    expect(permisoImportarFfcv({ ...SUPERADMIN, hayClubActivo: false })).toEqual({
      puede: false,
      motivo: 'sin_club_activo',
    });
  });

  it('sin sesión manda sobre todo lo demás (no se filtra un 403 por un 401)', () => {
    // Si el orden se invirtiera, alguien sin sesión recibiría «no tienes permiso»
    // en vez de «vuelve a entrar», y se quedaría mirando un botón que funciona.
    expect(
      permisoImportarFfcv({ haySesion: false, hayClubActivo: false, esSuperadmin: false }),
    ).toEqual({ puede: false, motivo: 'sin_sesion' });
    expect(
      permisoImportarFfcv({ haySesion: false, hayClubActivo: true, esSuperadmin: true }),
    ).toEqual({ puede: false, motivo: 'sin_sesion' });
  });

  it('NINGUNA combinación sin superadmin abre la puerta (las 4 que quedan)', () => {
    // El censo entero del espacio: con `esSuperadmin: false` no hay forma de entrar.
    // Un `||` nuevo en la regla —que es como se deshacen estas decisiones— rompe
    // este test aunque el caso que añada no esté nombrado arriba.
    for (const haySesion of [true, false]) {
      for (const hayClubActivo of [true, false]) {
        const r = permisoImportarFfcv({ haySesion, hayClubActivo, esSuperadmin: false });
        expect(r.puede, `entró con sesión=${haySesion} club=${hayClubActivo}`).toBe(false);
      }
    }
    // Y el control positivo: el único punto del espacio que sí entra. Sin esto, un
    // `return {puede:false}` fijo pasaría el bucle de arriba sin comprobar nada.
    expect(permisoImportarFfcv(SUPERADMIN).puede).toBe(true);
  });

  it('el ROL no es un dato de esta regla: no se le puede pasar', () => {
    // La defensa de verdad no es este test, es la FIRMA: `ActorFfcv` no tiene rol,
    // así que no existe el dato con el que equivocarse. Esto solo lo deja escrito
    // para quien lea los tests antes del código.
    const claves = Object.keys(SUPERADMIN).sort();
    expect(claves).toEqual(['esSuperadmin', 'hayClubActivo', 'haySesion']);
  });
});
