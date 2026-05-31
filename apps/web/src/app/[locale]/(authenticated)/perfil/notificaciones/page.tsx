import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Bell } from 'lucide-react';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PushSubscriptionPanel } from './push-subscription-panel';
import { PreferencesMatrix } from './preferences-matrix';
import {
  NOTIFICATION_CHANNELS_LIST,
  NOTIFICATION_TYPES_LIST,
} from './constants';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function NotificacionesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const t = await getTranslations('notificaciones');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, user_agent, last_seen_at')
    .eq('user_id', ctx.user.id)
    .order('last_seen_at', { ascending: false });

  const { data: prefRows } = await supabase
    .from('notification_preferences')
    .select('type, channel, enabled')
    .eq('user_id', ctx.user.id);

  // Build matrix initial state: LEFT JOIN default true.
  type Pref = { type: string; channel: string; enabled: boolean };
  const prefMap = new Map<string, boolean>();
  for (const p of (prefRows ?? []) as Pref[]) {
    prefMap.set(`${p.type}:${p.channel}`, p.enabled);
  }

  const initial: Record<string, boolean> = {};
  for (const type of NOTIFICATION_TYPES_LIST) {
    for (const channel of NOTIFICATION_CHANNELS_LIST) {
      const key = `${type}:${channel}`;
      // in_app siempre on (no opt-out, F5.6). email visible pero gris/forzado off
      // visualmente hasta F16; el valor real respeta lo que el user haya guardado.
      const fromDb = prefMap.get(key);
      initial[key] = fromDb ?? (channel === 'email' ? false : true);
    }
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/perfil">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back')}</span>
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Bell className="size-6" aria-hidden />
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('push.title')}</CardTitle>
          <CardDescription>{t('push.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <PushSubscriptionPanel
            vapidPublicKey={vapidPublicKey}
            initialSubscriptions={(subs ?? []).map((s) => ({
              id: s.id,
              endpoint: s.endpoint,
              user_agent: s.user_agent,
              last_seen_at: s.last_seen_at,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('preferences.title')}</CardTitle>
          <CardDescription>{t('preferences.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <PreferencesMatrix
            locale={locale}
            initial={initial}
            types={[...NOTIFICATION_TYPES_LIST]}
            channels={[...NOTIFICATION_CHANNELS_LIST]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
