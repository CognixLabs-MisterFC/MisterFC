import { describe, expect, it } from 'vitest';
import {
  invitationDeliveryOutcome,
  DELIVERY_FAILED_STATES,
  DELIVERY_UNCONFIRMED_AFTER_MS,
  type DeliveryCarrier,
} from '../delivery-status';

/**
 * A-3 — el desenlace de entrega que se pinta en /invitations.
 *
 * LA ASERCION QUE MAS VALE es «sin id de envio no se dice nada»: 14 de las 16
 * invitaciones que habia en produccion son anteriores a A-2 y de ellas no sabemos nada.
 * Si el umbral se les aplicara, la pantalla se encenderia entera el primer dia con filas
 * viejas y el aviso dejaria de significar algo.
 */

const AHORA = Date.parse('2026-09-24T14:00:00Z');
const HACE_UN_MINUTO = '2026-09-24T13:59:00Z';
const HACE_DOS_HORAS = '2026-09-24T12:00:00Z';

function inv(over: Partial<DeliveryCarrier> = {}): DeliveryCarrier {
  return {
    delivery_message_id: 'msg-1',
    delivery_state: null,
    delivery_at: null,
    created_at: HACE_UN_MINUTO,
    ...over,
  };
}

describe('invitationDeliveryOutcome', () => {
  it('sin id de envio NO dice nada, por viejo que sea (las anteriores a A-2)', () => {
    expect(
      invitationDeliveryOutcome(
        inv({ delivery_message_id: null, created_at: '2026-05-01T00:00:00Z' }),
        AHORA,
      ),
    ).toBe('ok');
  });

  it.each([...DELIVERY_FAILED_STATES])('%s es un fallo', (estado) => {
    expect(invitationDeliveryOutcome(inv({ delivery_state: estado }), AHORA)).toBe('failed');
  });

  it('un fallo lo sigue siendo por viejo que sea: no hay umbral que lo perdone', () => {
    expect(
      invitationDeliveryOutcome(
        inv({ delivery_state: 'bounced', delivery_at: '2026-01-01T00:00:00Z' }),
        AHORA,
      ),
    ).toBe('failed');
  });

  it('delivered cierra el caso en bueno', () => {
    expect(
      invitationDeliveryOutcome(
        inv({ delivery_state: 'delivered', delivery_at: HACE_DOS_HORAS }),
        AHORA,
      ),
    ).toBe('ok');
  });

  it('recien salida y sin evento todavia: no se avisa (13 s es lo normal)', () => {
    expect(invitationDeliveryOutcome(inv({ created_at: HACE_UN_MINUTO }), AHORA)).toBe('ok');
  });

  it('salida hace dos horas y sin un solo evento: sin confirmar', () => {
    expect(invitationDeliveryOutcome(inv({ created_at: HACE_DOS_HORAS }), AHORA)).toBe(
      'unconfirmed',
    );
  });

  it('EL CASO DE chaodis@: delivery_delayed que se eterniza', () => {
    // Medido: salio a las 10:04 y a las 14:27 seguia en `delivery_delayed`, sin rebotar.
    // Sin este aviso, esa invitacion se ve SANA toda la tarde.
    expect(
      invitationDeliveryOutcome(
        inv({ delivery_state: 'delivery_delayed', delivery_at: '2026-09-24T10:04:43Z' }),
        AHORA,
      ),
    ).toBe('unconfirmed');
  });

  it('un delivery_delayed RECIENTE no avisa: es informacion fresca, no silencio', () => {
    expect(
      invitationDeliveryOutcome(
        inv({ delivery_state: 'delivery_delayed', delivery_at: HACE_UN_MINUTO }),
        AHORA,
      ),
    ).toBe('ok');
  });

  it('el reloj cuenta desde el ULTIMO evento, no desde que se creo', () => {
    // Creada hace dos horas pero con un `sent` de hace un minuto: no se avisa.
    expect(
      invitationDeliveryOutcome(
        inv({ created_at: HACE_DOS_HORAS, delivery_state: 'sent', delivery_at: HACE_UN_MINUTO }),
        AHORA,
      ),
    ).toBe('ok');
  });

  it('un estado que no conocemos NO se da por bueno', () => {
    // No vamos a decir que un correo llego basandonos en una palabra que no sabemos leer.
    expect(
      invitationDeliveryOutcome(
        inv({ delivery_state: 'inventado_manana', delivery_at: HACE_DOS_HORAS }),
        AHORA,
      ),
    ).toBe('unconfirmed');
  });

  it('justo en el umbral ya avisa, y un pelo antes no', () => {
    const justo = new Date(AHORA - DELIVERY_UNCONFIRMED_AFTER_MS).toISOString();
    const unPeloAntes = new Date(AHORA - DELIVERY_UNCONFIRMED_AFTER_MS + 1000).toISOString();
    expect(invitationDeliveryOutcome(inv({ created_at: justo }), AHORA)).toBe('unconfirmed');
    expect(invitationDeliveryOutcome(inv({ created_at: unPeloAntes }), AHORA)).toBe('ok');
  });

  it('una fecha ilegible no se da por buena', () => {
    expect(invitationDeliveryOutcome(inv({ created_at: 'no es una fecha' }), AHORA)).toBe(
      'unconfirmed',
    );
  });

  it('el umbral son 30 minutos', () => {
    // Medido el 24-sep-2026: la entrega normal fueron 13 segundos.
    expect(DELIVERY_UNCONFIRMED_AFTER_MS).toBe(30 * 60 * 1000);
  });
});
