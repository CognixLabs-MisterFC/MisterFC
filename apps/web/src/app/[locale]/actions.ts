'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export async function signout(locale: string): Promise<void> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  await supabase.auth.signOut();

  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_CLUB_COOKIE_NAME);

  redirect(`/${locale}/signin`);
}
