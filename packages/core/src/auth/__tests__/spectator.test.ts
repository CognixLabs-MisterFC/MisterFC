import { describe, expect, it } from 'vitest';
import { resolveActivePlayer, type FollowedPlayer } from '../spectator';

const followed = (id: string): FollowedPlayer => ({
  playerId: id,
  clubId: 'c1',
  fullName: `Player ${id}`,
  teamId: null,
  teamName: null,
});

describe('resolveActivePlayer — seguidor (idOf por defecto = playerId)', () => {
  it('cookie válida → ese jugador, sin stale', () => {
    const players = [followed('a'), followed('b')];
    expect(resolveActivePlayer(players, 'b')).toEqual({
      active: followed('b'),
      staleCookie: false,
    });
  });

  it('cookie inválida → primero + staleCookie', () => {
    const players = [followed('a'), followed('b')];
    const r = resolveActivePlayer(players, 'zzz');
    expect(r.active).toEqual(followed('a'));
    expect(r.staleCookie).toBe(true);
  });

  it('sin cookie → primero, sin stale', () => {
    const players = [followed('a'), followed('b')];
    expect(resolveActivePlayer(players, null)).toEqual({
      active: followed('a'),
      staleCookie: false,
    });
  });

  it('lista vacía → null', () => {
    expect(resolveActivePlayer([], 'a')).toEqual({
      active: null,
      staleCookie: false,
    });
  });
});

describe('resolveActivePlayer — tutor (idOf = id, jugador activo nativo O2-5)', () => {
  type AccountPlayer = { id: string; name: string };
  const p = (id: string): AccountPlayer => ({ id, name: `Hijo ${id}` });
  const byId = (x: AccountPlayer) => x.id;

  it('guardado válido → ese hijo', () => {
    expect(resolveActivePlayer([p('h1'), p('h2')], 'h2', byId)).toEqual({
      active: p('h2'),
      staleCookie: false,
    });
  });

  it('guardado ajeno al club (no está en la lista) → primero + stale', () => {
    const r = resolveActivePlayer([p('h1'), p('h2')], 'otro-club', byId);
    expect(r.active).toEqual(p('h1'));
    expect(r.staleCookie).toBe(true);
  });

  it('sin valor guardado → primero (orden determinista)', () => {
    expect(resolveActivePlayer([p('h1'), p('h2')], null, byId).active).toEqual(
      p('h1'),
    );
  });

  it('tutor sin hijos en el club → null', () => {
    expect(resolveActivePlayer<AccountPlayer>([], 'h1', byId)).toEqual({
      active: null,
      staleCookie: false,
    });
  });
});
