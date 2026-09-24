import { describe, expect, it } from 'vitest';
import { effectiveInvitationTeamId } from '../pending-lists';

/**
 * EL EQUIPO DE UNA INVITACION en el listado de /invitations.
 *
 * El sintoma medido: TODAS las invitaciones de familia salian en "Sin equipo" —9 de 9
 * en produccion, vinieran del alta individual, del reenvio desde la ficha o del envio
 * en lote tras importar por Excel—, y ese listado es donde se mira cuantos han aceptado
 * por equipo. El club perseguia a las familias equivocadas.
 *
 * La causa no era la importacion: `invitations.team_id` nacio para la invitacion de
 * STAFF —invitas a un entrenador A UN EQUIPO— y la de familia nunca lo llevo. El
 * jugador esta en `team_members`.
 *
 * Aqui se prueba la REGLA, que es lo unico que tiene decision dentro. La consulta que
 * arma el mapa (`activeTeamByPlayer`) es fontaneria de PostgREST y se mide en la app.
 */
describe('effectiveInvitationTeamId', () => {
  const T_STAFF = 'team-staff';
  const T_HIJO = 'team-hijo';
  const mapa = new Map([['p1', T_HIJO]]);

  it('la de STAFF manda: el equipo es parte de lo que se invito', () => {
    expect(
      effectiveInvitationTeamId({ team_id: T_STAFF, player_id: null }, mapa),
    ).toBe(T_STAFF);
  });

  it('la de FAMILIA sale por el equipo vivo de su jugador', () => {
    expect(effectiveInvitationTeamId({ team_id: null, player_id: 'p1' }, mapa)).toBe(
      T_HIJO,
    );
  });

  it('si la invitacion trae equipo, ese GANA sobre el del jugador', () => {
    // No es un caso teorico: nada impide invitar al tutor desde un equipo concreto. Si
    // alguien lo hizo a proposito, su eleccion pesa mas que la pertenencia.
    expect(
      effectiveInvitationTeamId({ team_id: T_STAFF, player_id: 'p1' }, mapa),
    ).toBe(T_STAFF);
  });

  it('el jugador SIN equipo vivo cae en "Sin equipo", no se inventa uno', () => {
    expect(
      effectiveInvitationTeamId({ team_id: null, player_id: 'sin-equipo' }, mapa),
    ).toBeNull();
  });

  it('director y admin de club no van atados a equipo', () => {
    expect(effectiveInvitationTeamId({ team_id: null, player_id: null }, mapa)).toBeNull();
  });

  it('un mapa vacio no rompe: todo cae en "Sin equipo"', () => {
    // Es lo que pasa si el club no tiene temporada activa. Preferible a fallar: la
    // pantalla sigue pintando, con el mismo aspecto que tenia antes de este arreglo.
    expect(
      effectiveInvitationTeamId({ team_id: null, player_id: 'p1' }, new Map()),
    ).toBeNull();
  });
});
