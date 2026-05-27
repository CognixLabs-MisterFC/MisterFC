'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export async function signout(locale: string): Promise<void> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  await supabase.auth.signOut();
  redirect(`/${locale}/signin`);
}
