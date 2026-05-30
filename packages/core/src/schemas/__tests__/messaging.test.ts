import { describe, it, expect } from 'vitest';
import {
  sendMessageSchema,
  announcementInputSchema,
  auditReasonSchema,
  MESSAGE_RATE_LIMIT,
} from '../messaging';

describe('sendMessageSchema', () => {
  const validId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('acepta body en rango 1..2000', () => {
    const r = sendMessageSchema.safeParse({
      conversation_id: validId,
      body: 'hola',
    });
    expect(r.success).toBe(true);
  });

  it('trim del body (limpia whitespace) — body sólo de espacios rechaza', () => {
    const r = sendMessageSchema.safeParse({
      conversation_id: validId,
      body: '   ',
    });
    expect(r.success).toBe(false);
  });

  it('rechaza body > 2000 chars', () => {
    const r = sendMessageSchema.safeParse({
      conversation_id: validId,
      body: 'x'.repeat(2001),
    });
    expect(r.success).toBe(false);
  });

  it('acepta exactamente 2000 chars', () => {
    const r = sendMessageSchema.safeParse({
      conversation_id: validId,
      body: 'x'.repeat(2000),
    });
    expect(r.success).toBe(true);
  });

  it('rechaza conversation_id no-UUID', () => {
    const r = sendMessageSchema.safeParse({
      conversation_id: 'not-a-uuid',
      body: 'hola',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('conversation_invalid');
  });
});

describe('announcementInputSchema', () => {
  const teamId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const futureIso = new Date(Date.now() + 24 * 3600_000).toISOString();
  const pastIso = new Date(Date.now() - 24 * 3600_000).toISOString();

  it('acepta input mínimo (title + body)', () => {
    const r = announcementInputSchema.safeParse({
      team_id: teamId,
      title: 'Cancelado por lluvia',
      body: 'No habrá entrenamiento esta tarde.',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.pinned).toBe(false);
      expect(r.data.expires_at).toBe(null);
    }
  });

  it('pinned acepta string "on" (checkbox HTML) → true', () => {
    const r = announcementInputSchema.safeParse({
      team_id: teamId,
      title: 't',
      body: 'b',
      pinned: 'on',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.pinned).toBe(true);
  });

  it('expires_at futuro acepta', () => {
    const r = announcementInputSchema.safeParse({
      team_id: teamId,
      title: 't',
      body: 'b',
      expires_at: futureIso,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.expires_at).toBe(futureIso);
  });

  it('expires_at pasado rechaza con expires_at_must_be_future', () => {
    const r = announcementInputSchema.safeParse({
      team_id: teamId,
      title: 't',
      body: 'b',
      expires_at: pastIso,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === 'expires_at_must_be_future')).toBe(true);
    }
  });

  it('expires_at string vacía → null', () => {
    const r = announcementInputSchema.safeParse({
      team_id: teamId,
      title: 't',
      body: 'b',
      expires_at: '',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.expires_at).toBe(null);
  });

  it('title > 120 rechaza', () => {
    const r = announcementInputSchema.safeParse({
      team_id: teamId,
      title: 'x'.repeat(121),
      body: 'b',
    });
    expect(r.success).toBe(false);
  });
});

describe('auditReasonSchema', () => {
  it('acepta razón de 5 chars', () => {
    const r = auditReasonSchema.safeParse('queja');
    expect(r.success).toBe(true);
  });

  it('rechaza razón < 5 chars', () => {
    const r = auditReasonSchema.safeParse('ok');
    expect(r.success).toBe(false);
  });

  it('rechaza razón > 500 chars', () => {
    const r = auditReasonSchema.safeParse('x'.repeat(501));
    expect(r.success).toBe(false);
  });

  it('trim antes de validar — "  queja " (5 chars tras trim) OK', () => {
    const r = auditReasonSchema.safeParse('  queja ');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('queja');
  });
});

describe('MESSAGE_RATE_LIMIT', () => {
  it('30 mensajes / 5 min según spec D4', () => {
    expect(MESSAGE_RATE_LIMIT.maxMessages).toBe(30);
    expect(MESSAGE_RATE_LIMIT.windowSeconds).toBe(300);
  });
});
