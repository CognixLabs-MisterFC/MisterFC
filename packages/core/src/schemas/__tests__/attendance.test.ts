import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_CODES,
  ATTENDANCE_QUICK_CYCLE,
  ATTENDANCE_PRIMARY_CHIPS,
  ATTENDANCE_SECONDARY_CHIPS,
  ATTENDANCE_CODES_JUSTIFIED,
  ATTENDANCE_CODES_PRESENT,
  ATTENDANCE_CODES_UNJUSTIFIED,
  ATTENDANCE_CODES_PARTIAL,
  bucketOf,
  isPrimaryChip,
  markAttendanceBulkSchema,
  markAttendanceSchema,
  nextQuickCycle,
  otherChipLabel,
  type AttendanceCode,
} from '../attendance';

const eventId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1';
const playerId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbb1';

describe('ATTENDANCE_CODES catalog (contrato F8/F9)', () => {
  it('expone exactamente los 10 códigos acordados en spec 4.0', () => {
    // Orden importa — ADR-0007 lo sella como contrato. Si este test rompe,
    // hay que actualizar ADR + migración + F8/F9 antes de mergear.
    expect(ATTENDANCE_CODES).toEqual([
      'presente',
      'ausente',
      'ausente_con_aviso',
      'entreno_diferenciado',
      'lesionado',
      'enfermo',
      'partido_oficial',
      'viaje',
      'sancionado',
      'descanso',
    ]);
  });

  it('los buckets stat-side particionan los 10 códigos sin solapes', () => {
    const all = new Set<string>([
      ...ATTENDANCE_CODES_PRESENT,
      ...ATTENDANCE_CODES_JUSTIFIED,
      ...ATTENDANCE_CODES_UNJUSTIFIED,
      ...ATTENDANCE_CODES_PARTIAL,
    ]);
    expect(all.size).toBe(ATTENDANCE_CODES.length);
    // Cada código debe estar en exactamente uno.
    const totalSlots =
      ATTENDANCE_CODES_PRESENT.length +
      ATTENDANCE_CODES_JUSTIFIED.length +
      ATTENDANCE_CODES_UNJUSTIFIED.length +
      ATTENDANCE_CODES_PARTIAL.length;
    expect(totalSlots).toBe(ATTENDANCE_CODES.length);
  });

  it('bucketOf clasifica cada código correctamente', () => {
    expect(bucketOf('presente')).toBe('present');
    expect(bucketOf('ausente')).toBe('unjustified');
    expect(bucketOf('ausente_con_aviso')).toBe('justified');
    expect(bucketOf('entreno_diferenciado')).toBe('partial');
    expect(bucketOf('lesionado')).toBe('justified');
    expect(bucketOf('descanso')).toBe('justified');
  });
});

describe('nextQuickCycle (UI ciclo rápido)', () => {
  it('null → presente', () => {
    expect(nextQuickCycle(null)).toBe('presente');
    expect(nextQuickCycle(undefined)).toBe('presente');
  });

  it('cicla presente → ausente → ausente_con_aviso → presente', () => {
    expect(nextQuickCycle('presente')).toBe('ausente');
    expect(nextQuickCycle('ausente')).toBe('ausente_con_aviso');
    expect(nextQuickCycle('ausente_con_aviso')).toBe('presente');
  });

  it('códigos fuera del ciclo rápido vuelven a presente', () => {
    const offCycle: AttendanceCode[] = [
      'lesionado',
      'enfermo',
      'partido_oficial',
      'viaje',
      'sancionado',
      'descanso',
      'entreno_diferenciado',
    ];
    for (const c of offCycle) {
      expect(nextQuickCycle(c)).toBe('presente');
    }
  });

  it('ATTENDANCE_QUICK_CYCLE es subset estricto de ATTENDANCE_CODES', () => {
    for (const c of ATTENDANCE_QUICK_CYCLE) {
      expect(ATTENDANCE_CODES).toContain(c);
    }
  });
});

describe('markAttendanceSchema', () => {
  it('acepta el caso happy', () => {
    const r = markAttendanceSchema.safeParse({
      event_id: eventId,
      player_id: playerId,
      code: 'presente',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.notes).toBeNull();
  });

  it('trim + null para notes vacías', () => {
    const r = markAttendanceSchema.safeParse({
      event_id: eventId,
      player_id: playerId,
      code: 'lesionado',
      notes: '   ',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.notes).toBeNull();
  });

  it('preserva notes con contenido tras trim', () => {
    const r = markAttendanceSchema.safeParse({
      event_id: eventId,
      player_id: playerId,
      code: 'lesionado',
      notes: '  tobillo derecho  ',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.notes).toBe('tobillo derecho');
  });

  it('rechaza código inválido con mensaje code_invalid', () => {
    const r = markAttendanceSchema.safeParse({
      event_id: eventId,
      player_id: playerId,
      code: 'inventado',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('code_invalid');
    }
  });

  it('rechaza event_id no UUID con event_invalid', () => {
    const r = markAttendanceSchema.safeParse({
      event_id: 'not-a-uuid',
      player_id: playerId,
      code: 'presente',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('event_invalid');
  });

  it('rechaza notes >500 chars', () => {
    const r = markAttendanceSchema.safeParse({
      event_id: eventId,
      player_id: playerId,
      code: 'enfermo',
      notes: 'x'.repeat(501),
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('notes_too_long');
  });
});

describe('markAttendanceBulkSchema', () => {
  it('acepta varias entradas', () => {
    const r = markAttendanceBulkSchema.safeParse({
      event_id: eventId,
      entries: [
        { player_id: playerId, code: 'presente' },
        {
          player_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          code: 'ausente_con_aviso',
        },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.entries).toHaveLength(2);
    }
  });

  it('rechaza array vacío con entries_required', () => {
    const r = markAttendanceBulkSchema.safeParse({
      event_id: eventId,
      entries: [],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('entries_required');
    }
  });

  it('rechaza >100 entradas con entries_too_many', () => {
    // UUID v4 fijo + hexa de 3 dígitos para el index → 101 UUIDs válidos
    // y distintos (no choca con el límite de 100 entries del schema).
    const hex = (n: number) => n.toString(16).padStart(3, '0');
    const big = Array.from({ length: 101 }, (_, i) => ({
      player_id: `dddddddd-dddd-4ddd-8ddd-ddddddddd${hex(i)}`,
      code: 'presente' as const,
    }));
    const r = markAttendanceBulkSchema.safeParse({
      event_id: eventId,
      entries: big,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('entries_too_many');
    }
  });
});

describe('ATTENDANCE_PRIMARY_CHIPS (UI tabla F4.2)', () => {
  it('expone exactamente 3 chips primarios: presente, ausente, lesionado', () => {
    expect(ATTENDANCE_PRIMARY_CHIPS).toEqual([
      'presente',
      'ausente',
      'lesionado',
    ]);
  });

  it('chips primarios + secundarios cubren los 10 códigos sin solapes', () => {
    const all = new Set<string>([
      ...ATTENDANCE_PRIMARY_CHIPS,
      ...ATTENDANCE_SECONDARY_CHIPS,
    ]);
    expect(all.size).toBe(ATTENDANCE_CODES.length);
    expect(
      ATTENDANCE_PRIMARY_CHIPS.length + ATTENDANCE_SECONDARY_CHIPS.length
    ).toBe(ATTENDANCE_CODES.length);
  });

  it('cada chip primario está en el catálogo global', () => {
    for (const c of ATTENDANCE_PRIMARY_CHIPS) {
      expect(ATTENDANCE_CODES).toContain(c);
    }
  });

  it('isPrimaryChip clasifica correctamente', () => {
    expect(isPrimaryChip('presente')).toBe(true);
    expect(isPrimaryChip('ausente')).toBe(true);
    expect(isPrimaryChip('lesionado')).toBe(true);
    expect(isPrimaryChip('ausente_con_aviso')).toBe(false);
    expect(isPrimaryChip('entreno_diferenciado')).toBe(false);
    expect(isPrimaryChip('enfermo')).toBe(false);
    expect(isPrimaryChip('partido_oficial')).toBe(false);
    expect(isPrimaryChip('viaje')).toBe(false);
    expect(isPrimaryChip('sancionado')).toBe(false);
    expect(isPrimaryChip('descanso')).toBe(false);
  });
});

describe('otherChipLabel (label dinámico del botón Otros)', () => {
  it('sin marca → null (renderizar placeholder por defecto)', () => {
    expect(otherChipLabel(null)).toBeNull();
    expect(otherChipLabel(undefined)).toBeNull();
  });

  it('marca primaria → null (la indicación va en el chip)', () => {
    for (const c of ATTENDANCE_PRIMARY_CHIPS) {
      expect(otherChipLabel(c)).toBeNull();
    }
  });

  it('marca secundaria → devuelve el código activo', () => {
    for (const c of ATTENDANCE_SECONDARY_CHIPS) {
      expect(otherChipLabel(c)).toBe(c);
    }
  });
});
