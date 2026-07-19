import { describe, expect, it } from 'vitest';
import {
  summarizePendingInvites,
  type PendingInviteCandidate,
} from '../pending';

const p = (
  player_id: string,
  invite_email: string,
  first_name = 'N',
  last_name = 'A',
): PendingInviteCandidate => ({ player_id, first_name, last_name, invite_email });

describe('summarizePendingInvites', () => {
  it('lista vacía → todo a cero', () => {
    const s = summarizePendingInvites([]);
    expect(s.count_players).toBe(0);
    expect(s.count_emails).toBe(0);
    expect(s.emails).toEqual([]);
    expect(s.players).toEqual([]);
  });

  it('hermanos: 4 jugadores, 2 emails distintos → count_emails = 2', () => {
    const s = summarizePendingInvites([
      p('j1', 'padre@a.com'),
      p('j2', 'padre@a.com'),
      p('j3', 'madre@b.com'),
      p('j4', 'padre@a.com'),
    ]);
    expect(s.count_players).toBe(4);
    expect(s.count_emails).toBe(2);
    // Agrupado: padre@a.com con [j1,j2,j4]; madre@b.com con [j3].
    expect(s.emails).toEqual([
      { email: 'padre@a.com', player_ids: ['j1', 'j2', 'j4'] },
      { email: 'madre@b.com', player_ids: ['j3'] },
    ]);
  });

  it('agrupa case-insensitive y con espacios (mismo email escrito distinto = 1)', () => {
    const s = summarizePendingInvites([
      p('j1', 'Padre@A.com'),
      p('j2', '  padre@a.com '),
    ]);
    expect(s.count_emails).toBe(1);
    expect(s.emails).toHaveLength(1);
    expect(s.emails[0]!.player_ids).toEqual(['j1', 'j2']);
    // Conserva el primer email visto (trim), sin normalizar a minúsculas.
    expect(s.emails[0]!.email).toBe('Padre@A.com');
  });

  it('todos distintos → count_emails = count_players', () => {
    const s = summarizePendingInvites([
      p('j1', 'a@x.com'),
      p('j2', 'b@x.com'),
      p('j3', 'c@x.com'),
    ]);
    expect(s.count_players).toBe(3);
    expect(s.count_emails).toBe(3);
  });

  it('preserva el orden de aparición de los emails', () => {
    const s = summarizePendingInvites([
      p('j1', 'z@x.com'),
      p('j2', 'a@x.com'),
      p('j3', 'z@x.com'),
    ]);
    expect(s.emails.map((e) => e.email)).toEqual(['z@x.com', 'a@x.com']);
  });
});
