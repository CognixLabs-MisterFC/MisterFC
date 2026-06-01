import { describe, expect, it } from 'vitest';
import { avatarInitials, formatPlayerName, playerInitials } from '../name';

describe('formatPlayerName', () => {
  it('apellido, nombre cuando hay ambos', () => {
    expect(formatPlayerName('Pepe', 'Gómez')).toBe('Gómez, Pepe');
  });
  it('solo el nombre si no hay apellido', () => {
    expect(formatPlayerName('Pepe', null)).toBe('Pepe');
    expect(formatPlayerName('Pepe', '   ')).toBe('Pepe');
  });
});

describe('playerInitials (listados — apellido primero)', () => {
  it('apellido+nombre', () => {
    expect(playerInitials('Pedro', 'Sánchez')).toBe('SP');
  });
  it('solo nombre', () => {
    expect(playerInitials('Ana', null)).toBe('A');
  });
});

describe('avatarInitials (placeholder del avatar, mejora I — nombre primero)', () => {
  it('nombre + apellido → "PS"', () => {
    expect(avatarInitials('Pedro', 'Sánchez')).toBe('PS');
  });
  it('solo nombre → una inicial', () => {
    expect(avatarInitials('Ana', null)).toBe('A');
    expect(avatarInitials('ana', '')).toBe('A');
  });
  it('sin datos → "·"', () => {
    expect(avatarInitials(null, null)).toBe('·');
    expect(avatarInitials('   ', '  ')).toBe('·');
  });
});
