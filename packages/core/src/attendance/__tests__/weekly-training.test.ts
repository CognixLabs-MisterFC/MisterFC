import { describe, it, expect } from 'vitest';
import {
  workweekRange,
  trainingsInMatchWeek,
  computeWeeklyTrainingAttendance,
  isAttendedCode,
  type TrainingDay,
  type AttendanceMark,
} from '../weekly-training';

describe('workweekRange — lunes y viernes de la semana del partido', () => {
  it('miércoles 2026-06-10 → lunes 2026-06-08, viernes 2026-06-12', () => {
    expect(workweekRange('2026-06-10')).toEqual({ monday: '2026-06-08', friday: '2026-06-12' });
  });
  it('lunes → su propia semana', () => {
    expect(workweekRange('2026-06-08')).toEqual({ monday: '2026-06-08', friday: '2026-06-12' });
  });
  it('domingo 2026-06-14 pertenece a la semana lun 08–vie 12', () => {
    expect(workweekRange('2026-06-14')).toEqual({ monday: '2026-06-08', friday: '2026-06-12' });
  });
  it('sábado 2026-06-13 también', () => {
    expect(workweekRange('2026-06-13')).toEqual({ monday: '2026-06-08', friday: '2026-06-12' });
  });
});

describe('trainingsInMatchWeek — solo L–V de la semana del partido', () => {
  const trainings: TrainingDay[] = [
    { id: 'prevFri', date: '2026-06-05' }, // viernes semana anterior → fuera
    { id: 'mon', date: '2026-06-08' },
    { id: 'wed', date: '2026-06-10' },
    { id: 'fri', date: '2026-06-12' },
    { id: 'sat', date: '2026-06-13' }, // sábado → fuera
    { id: 'nextMon', date: '2026-06-15' }, // fuera
  ];
  it('partido el sábado: incluye lun/mié/vie de su semana, excluye sáb/dom y otras semanas', () => {
    const ids = trainingsInMatchWeek('2026-06-13', trainings).map((t) => t.id);
    expect(ids).toEqual(['mon', 'wed', 'fri']);
  });
});

describe('isAttendedCode — present/partial cuentan; ausencias no', () => {
  it('presente y entreno_diferenciado sí; ausencias no', () => {
    expect(isAttendedCode('presente')).toBe(true);
    expect(isAttendedCode('entreno_diferenciado')).toBe(true); // partial: acudió
    expect(isAttendedCode('ausente')).toBe(false);
    expect(isAttendedCode('ausente_con_aviso')).toBe(false);
    expect(isAttendedCode('lesionado')).toBe(false);
  });
});

describe('computeWeeklyTrainingAttendance', () => {
  const trainings: TrainingDay[] = [
    { id: 'mon', date: '2026-06-08' },
    { id: 'wed', date: '2026-06-10' },
    { id: 'satOut', date: '2026-06-13' }, // sábado, no cuenta
  ];
  const attendance: AttendanceMark[] = [
    { playerId: 'p1', eventId: 'mon', code: 'presente' },
    { playerId: 'p1', eventId: 'wed', code: 'ausente' },
    { playerId: 'p2', eventId: 'mon', code: 'entreno_diferenciado' },
    { playerId: 'p2', eventId: 'wed', code: 'presente' },
    { playerId: 'p2', eventId: 'satOut', code: 'presente' }, // fuera de L–V
  ];

  it('cuenta asistidos/total sobre los 2 entrenos L–V (sábado excluido)', () => {
    const r = computeWeeklyTrainingAttendance({
      matchDate: '2026-06-13',
      trainings,
      attendance,
      rosterIds: ['p1', 'p2', 'p3'],
    });
    expect(r.totalTrainings).toBe(2);
    expect(r.byPlayer.get('p1')).toEqual({ attended: 1, total: 2 }); // presente + ausente
    expect(r.byPlayer.get('p2')).toEqual({ attended: 2, total: 2 }); // diferenciado + presente
    expect(r.byPlayer.get('p3')).toEqual({ attended: 0, total: 2 }); // sin registro
  });

  it('sin entrenos esa semana → total 0 (el caller oculta)', () => {
    const r = computeWeeklyTrainingAttendance({
      matchDate: '2026-07-01',
      trainings,
      attendance,
      rosterIds: ['p1'],
    });
    expect(r.totalTrainings).toBe(0);
    expect(r.byPlayer.get('p1')).toEqual({ attended: 0, total: 0 });
  });
});
