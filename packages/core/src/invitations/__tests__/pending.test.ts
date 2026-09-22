import { describe, expect, it } from 'vitest';
import {
  summarizePendingInvites,
  pendingCoversEmail,
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

  /**
   * EL PRIMER `player_id` DE CADA GRUPO ES EL ANCLA DEL CORREO, y por eso el orden
   * de entrada no es un detalle: el lote manda UN correo por familia con la
   * invitación de ese primer jugador, y el enlace del correo lleva a ella. Mientras
   * la consulta de pendientes no ordenaba, el ancla era un hijo cualquiera: quien
   * importaba a un niño recibía el enlace de otro, y la pantalla de aceptar le
   * enseñaba una ficha que no era la suya. La consulta ya ordena por `created_at`;
   * esto fija la otra mitad del contrato —que este agrupado NO reordena—, que es la
   * que vive en core y la que el CI ejecuta.
   */
  it('el ancla del correo es el primer jugador que llega, y el agrupado no reordena', () => {
    const s = summarizePendingInvites([
      p('mayor', 'padre@a.com'),
      p('mediano', 'padre@a.com'),
      p('pequeno', 'padre@a.com'),
    ]);
    expect(s.emails).toHaveLength(1);
    expect(s.emails[0]!.player_ids[0]).toBe('mayor');
    expect(s.emails[0]!.player_ids).toEqual(['mayor', 'mediano', 'pequeno']);
  });
});

describe('pendingCoversEmail', () => {
  const inv = (id: string) => ({ id });

  it('sin pendientes → no cubre: hay que mandar el correo', () => {
    expect(pendingCoversEmail([])).toBe(false);
  });

  it('una pendiente ajena → cubre: el enlace que ya tiene sirve para el hijo nuevo', () => {
    expect(pendingCoversEmail([inv('i1')])).toBe(true);
  });

  /**
   * La distinción que de verdad importa. Renovar la PROPIA invitación es un
   * REENVÍO pedido a mano desde la ficha: tiene que salir correo, porque si no el
   * botón se queda mudo y el que lo pulsa no sabe si ha hecho algo.
   */
  it('solo está la que renuevo → NO cubre: reenviar a mano sí manda correo', () => {
    expect(pendingCoversEmail([inv('i1')], { renewingId: 'i1' })).toBe(false);
  });

  it('renuevo la mía pero hay otra de un hermano → cubre', () => {
    expect(pendingCoversEmail([inv('i1'), inv('i2')], { renewingId: 'i1' })).toBe(true);
  });

  it('renewingId que no está en la lista → cuenta todas las que hay', () => {
    expect(pendingCoversEmail([inv('i1')], { renewingId: 'otra' })).toBe(true);
  });

  it('renewingId null o ausente son lo mismo', () => {
    expect(pendingCoversEmail([inv('i1')], { renewingId: null })).toBe(true);
    expect(pendingCoversEmail([inv('i1')], {})).toBe(true);
  });
});
