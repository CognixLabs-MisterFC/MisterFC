'use server';

import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { createSupabaseServerClient } from '@misterfc/core';
import type { Database } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';

type NotificationType = Database['public']['Enums']['notification_type'];
type NotificationChannel = Database['public']['Enums']['notification_channel'];

import {
  NOTIFICATION_TYPES_LIST as NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS_LIST as NOTIFICATION_CHANNELS,
} from './constants';

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  p256dh: z.string().min(1).max(255),
  auth: z.string().min(1).max(255),
  user_agent: z.string().max(500).optional(),
});

export type SubscribeResult = {
  ok?: { subscription_id: string };
  error?: 'forbidden' | 'invalid_payload' | 'generic';
};

/**
 * F5.5 — registra una suscripción Web Push del usuario actual. Idempotente:
 * el `endpoint` es UNIQUE, así que si la misma suscripción se reenvía
 * (navegador re-suscribe tras renovación de claves) hacemos UPSERT por
 * endpoint. user_agent se guarda para que el user identifique el
 * dispositivo en la futura UI de gestión.
 */
export async function subscribePush(input: unknown): Promise<SubscribeResult> {
  const parsed = subscribeSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid_payload' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // UPSERT por endpoint — si ya existe (mismo dispositivo re-suscribiéndose)
  // actualiza last_seen_at y los keys por si rotaron.
  const { data, error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: ctx.user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.p256dh,
        auth: parsed.data.auth,
        user_agent: parsed.data.user_agent ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )
    .select('id')
    .single();

  if (error || !data) {
    if (error?.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(error ?? new Error('subscribe push returned null'), {
      tags: { feature: 'push', step: 'subscribe' },
    });
    return { error: 'generic' };
  }

  return { ok: { subscription_id: data.id } };
}

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

export async function unsubscribePush(
  input: unknown,
): Promise<{ ok?: true; error?: 'forbidden' | 'invalid_payload' | 'generic' }> {
  const parsed = unsubscribeSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid_payload' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', ctx.user.id)
    .eq('endpoint', parsed.data.endpoint);

  if (error) {
    Sentry.captureException(error, {
      tags: { feature: 'push', step: 'unsubscribe' },
    });
    return { error: 'generic' };
  }
  return { ok: true };
}

const preferenceSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES as [NotificationType, ...NotificationType[]]),
  channel: z.enum(
    NOTIFICATION_CHANNELS as [NotificationChannel, ...NotificationChannel[]],
  ),
  enabled: z.boolean(),
});

export async function updateNotificationPreference(
  locale: string,
  input: unknown,
): Promise<{ ok?: true; error?: 'forbidden' | 'invalid_payload' | 'generic' }> {
  const parsed = preferenceSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid_payload' };

  // F5.6 — `in_app` no es opt-out: la campana siempre se llena. Si el form
  // intenta apagarla, ignoramos silenciosamente.
  if (parsed.data.channel === 'in_app' && !parsed.data.enabled) {
    return { error: 'invalid_payload' };
  }

  // `email` es un canal placeholder hasta F16 SMTP; aceptamos guardar la
  // preferencia pero ningún drainer la usa todavía.

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('notification_preferences')
    .upsert(
      {
        user_id: ctx.user.id,
        type: parsed.data.type,
        channel: parsed.data.channel,
        enabled: parsed.data.enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,type,channel' },
    );

  if (error) {
    if (error.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(error, {
      tags: { feature: 'push', step: 'update_preference' },
    });
    return { error: 'generic' };
  }

  revalidatePath(`/${locale}/perfil/notificaciones`);
  return { ok: true };
}
