import { describe, expect, it } from 'vitest';
import {
  upsertRivalHighlightSchema,
  deleteRivalHighlightSchema,
  setMatchNotesSchema,
} from '../match-event';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('upsertRivalHighlightSchema — F7.11 rival destacado', () => {
  it('acepta dorsal 1–99 + nota libre', () => {
    const r = upsertRivalHighlightSchema.safeParse({ event_id: UUID, dorsal: 10, note: 'Muy rápido' });
    expect(r.success).toBe(true);
  });

  it('recorta la nota y exige al menos 1 carácter', () => {
    expect(upsertRivalHighlightSchema.safeParse({ event_id: UUID, dorsal: 7, note: '   ' }).success).toBe(false);
    const ok = upsertRivalHighlightSchema.safeParse({ event_id: UUID, dorsal: 7, note: '  duro  ' });
    expect(ok.success && ok.data.note).toBe('duro');
  });

  it('rechaza dorsal fuera de 1–99 y nota >200', () => {
    expect(upsertRivalHighlightSchema.safeParse({ event_id: UUID, dorsal: 0, note: 'x' }).success).toBe(false);
    expect(upsertRivalHighlightSchema.safeParse({ event_id: UUID, dorsal: 100, note: 'x' }).success).toBe(false);
    expect(
      upsertRivalHighlightSchema.safeParse({ event_id: UUID, dorsal: 9, note: 'a'.repeat(201) }).success,
    ).toBe(false);
  });
});

describe('deleteRivalHighlightSchema', () => {
  it('exige event_id y dorsal válido', () => {
    expect(deleteRivalHighlightSchema.safeParse({ event_id: UUID, dorsal: 5 }).success).toBe(true);
    expect(deleteRivalHighlightSchema.safeParse({ event_id: 'no', dorsal: 5 }).success).toBe(false);
  });
});

describe('setMatchNotesSchema — notas del partido', () => {
  it('acepta texto (incluido vacío para borrar) hasta 4000', () => {
    expect(setMatchNotesSchema.safeParse({ event_id: UUID, notes: '' }).success).toBe(true);
    expect(setMatchNotesSchema.safeParse({ event_id: UUID, notes: 'Buen partido' }).success).toBe(true);
    expect(setMatchNotesSchema.safeParse({ event_id: UUID, notes: 'x'.repeat(4001) }).success).toBe(false);
  });
});
