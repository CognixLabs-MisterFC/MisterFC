import { describe, expect, it } from 'vitest';
import {
  createPlayerNoteSchema,
  updatePlayerNoteSchema,
  deletePlayerNoteSchema,
} from '../player-notes';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

describe('createPlayerNoteSchema', () => {
  it('acepta player_id + nota (recorta) y opcionalmente match/team', () => {
    const r = createPlayerNoteSchema.safeParse({
      player_id: UUID,
      note: '  muy rápido  ',
      match_event_id: UUID2,
    });
    expect(r.success && r.data.note).toBe('muy rápido');
    expect(r.success && r.data.match_event_id).toBe(UUID2);
  });
  it('rechaza nota vacía / solo espacios / >2000', () => {
    expect(createPlayerNoteSchema.safeParse({ player_id: UUID, note: '   ' }).success).toBe(false);
    expect(createPlayerNoteSchema.safeParse({ player_id: UUID, note: 'x'.repeat(2001) }).success).toBe(false);
  });
  it('rechaza player_id no-uuid', () => {
    expect(createPlayerNoteSchema.safeParse({ player_id: 'no', note: 'x' }).success).toBe(false);
  });
});

describe('updatePlayerNoteSchema / deletePlayerNoteSchema', () => {
  it('update exige id + nota', () => {
    expect(updatePlayerNoteSchema.safeParse({ id: UUID, note: 'ok' }).success).toBe(true);
    expect(updatePlayerNoteSchema.safeParse({ id: UUID, note: '' }).success).toBe(false);
  });
  it('delete exige id', () => {
    expect(deletePlayerNoteSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(deletePlayerNoteSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});
