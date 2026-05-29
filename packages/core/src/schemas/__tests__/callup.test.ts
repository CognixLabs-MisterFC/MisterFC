import { describe, expect, it } from 'vitest';
import {
  CALLUP_DECISION_KINDS,
  CALLUP_RESPONSE_STATUSES,
  TRANSPORT_MODES,
  publishCallupSchema,
  upsertCallupDecisionSchema,
  upsertCallupResponseSchema,
} from '../callup';

const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const playerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

describe('catálogos F4.3', () => {
  it('TRANSPORT_MODES tiene 3 valores', () => {
    expect(TRANSPORT_MODES).toEqual(['club', 'individual', 'mixed']);
  });

  it('CALLUP_RESPONSE_STATUSES tiene 3 valores', () => {
    expect(CALLUP_RESPONSE_STATUSES).toEqual(['yes', 'maybe', 'no']);
  });

  it('CALLUP_DECISION_KINDS tiene 2 valores', () => {
    expect(CALLUP_DECISION_KINDS).toEqual(['called_up', 'discarded']);
  });
});

describe('publishCallupSchema', () => {
  it('happy path: meta válida + publicada', () => {
    const r = publishCallupSchema.safeParse({
      event_id: eventId,
      meeting_at: '2026-06-01T17:00:00Z',
      meeting_location: 'Vestuario visitante',
      meeting_address: 'Av. del Club, 12',
      transport_mode: 'club',
      transport_notes: 'Salida del bus 16:30',
      notes_general: 'Llevar dos botellines de agua',
      publish: true,
    });
    expect(r.success).toBe(true);
  });

  it('trim + null para campos opcionales vacíos', () => {
    const r = publishCallupSchema.safeParse({
      event_id: eventId,
      meeting_at: '2026-06-01T17:00:00Z',
      meeting_location: 'Campo',
      meeting_address: '   ',
      transport_notes: '',
      notes_general: '   ',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.meeting_address).toBeNull();
      expect(r.data.transport_notes).toBeNull();
      expect(r.data.notes_general).toBeNull();
      expect(r.data.publish).toBe(false);
    }
  });

  it('rechaza meeting_at no parseable', () => {
    const r = publishCallupSchema.safeParse({
      event_id: eventId,
      meeting_at: 'mañana 5pm',
      meeting_location: 'Campo',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('meeting_at_invalid');
    }
  });

  it('rechaza meeting_location vacío', () => {
    const r = publishCallupSchema.safeParse({
      event_id: eventId,
      meeting_at: '2026-06-01T17:00:00Z',
      meeting_location: '',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('meeting_location_required');
    }
  });

  it('rechaza meeting_location > 200 chars', () => {
    const r = publishCallupSchema.safeParse({
      event_id: eventId,
      meeting_at: '2026-06-01T17:00:00Z',
      meeting_location: 'x'.repeat(201),
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('meeting_location_too_long');
    }
  });

  it('rechaza transport_mode inválido', () => {
    const r = publishCallupSchema.safeParse({
      event_id: eventId,
      meeting_at: '2026-06-01T17:00:00Z',
      meeting_location: 'Campo',
      transport_mode: 'tren',
    });
    expect(r.success).toBe(false);
  });
});

describe('upsertCallupResponseSchema', () => {
  it('acepta yes/maybe/no', () => {
    for (const status of CALLUP_RESPONSE_STATUSES) {
      const r = upsertCallupResponseSchema.safeParse({
        event_id: eventId,
        player_id: playerId,
        status,
      });
      expect(r.success).toBe(true);
    }
  });

  it('trim + null para reason vacía', () => {
    const r = upsertCallupResponseSchema.safeParse({
      event_id: eventId,
      player_id: playerId,
      status: 'maybe',
      reason: '   ',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reason).toBeNull();
  });

  it('preserva reason tras trim', () => {
    const r = upsertCallupResponseSchema.safeParse({
      event_id: eventId,
      player_id: playerId,
      status: 'no',
      reason: '  campamento de inglés  ',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reason).toBe('campamento de inglés');
  });

  it('rechaza status inválido', () => {
    const r = upsertCallupResponseSchema.safeParse({
      event_id: eventId,
      player_id: playerId,
      status: 'tal_vez',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('status_invalid');
  });

  it('rechaza reason > 500 chars', () => {
    const r = upsertCallupResponseSchema.safeParse({
      event_id: eventId,
      player_id: playerId,
      status: 'no',
      reason: 'x'.repeat(501),
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('reason_too_long');
  });
});

describe('upsertCallupDecisionSchema', () => {
  it('acepta called_up / discarded', () => {
    for (const decision of CALLUP_DECISION_KINDS) {
      const r = upsertCallupDecisionSchema.safeParse({
        event_id: eventId,
        player_id: playerId,
        decision,
      });
      expect(r.success).toBe(true);
    }
  });

  it('rechaza decision inválida', () => {
    const r = upsertCallupDecisionSchema.safeParse({
      event_id: eventId,
      player_id: playerId,
      decision: 'tal_vez',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('decision_invalid');
    }
  });
});
