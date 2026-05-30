import { z } from 'zod';

/**
 * F5 Lote A — schemas Zod para mensajería y anuncios.
 *
 * El server action las usa para validar el FormData de los formularios; el
 * cliente las puede usar también para validar inline antes de enviar. Las
 * RLS de BD son la autoridad final.
 *
 * Length limits coinciden con los CHECKs de la migración 20260605000000:
 *  - message body 1..2000
 *  - announcement title 1..120, body 1..2000
 *  - audit reason 5..500
 */

const trimmedString = (min: number, max: number) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(min).max(max));

export const startConversationSchema = z.object({
  player_id: z.string().uuid({ message: 'player_invalid' }),
});

export type StartConversationInput = z.infer<typeof startConversationSchema>;

export const sendMessageSchema = z.object({
  conversation_id: z.string().uuid({ message: 'conversation_invalid' }),
  body: trimmedString(1, 2000),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const announcementInputSchema = z.object({
  team_id: z.string().uuid({ message: 'team_invalid' }),
  title: trimmedString(1, 120),
  body: trimmedString(1, 2000),
  pinned: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) =>
      typeof v === 'string' ? v === 'on' || v === 'true' : Boolean(v),
    ),
  expires_at: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      if (s.length === 0) return null;
      return s; // se valida como ISO en el refine de abajo
    })
    .refine(
      (v) => {
        if (v === null) return true;
        const t = Date.parse(v);
        return Number.isFinite(t) && t > Date.now();
      },
      { message: 'expires_at_must_be_future' },
    ),
});

export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

export const announcementUpdateSchema = z.object({
  announcement_id: z.string().uuid({ message: 'announcement_invalid' }),
  title: trimmedString(1, 120).optional(),
  body: trimmedString(1, 2000).optional(),
  pinned: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) =>
      v === undefined
        ? undefined
        : typeof v === 'string'
          ? v === 'on' || v === 'true'
          : Boolean(v),
    ),
  expires_at: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const s = String(v).trim();
      if (s.length === 0) return null;
      return s;
    })
    .refine(
      (v) => {
        if (v === undefined || v === null) return true;
        const t = Date.parse(v);
        return Number.isFinite(t) && t > Date.now();
      },
      { message: 'expires_at_must_be_future' },
    ),
});

export type AnnouncementUpdateInput = z.infer<typeof announcementUpdateSchema>;

export const auditReasonSchema = trimmedString(5, 500);

/**
 * Rate limit del envío de mensajes: max 30 mensajes / 5 min por sender.
 * El server action lo enforce contra `messages` filtrando por sender y
 * sent_at > now() - 5 min.
 */
export const MESSAGE_RATE_LIMIT = {
  maxMessages: 30,
  windowSeconds: 5 * 60,
} as const;
