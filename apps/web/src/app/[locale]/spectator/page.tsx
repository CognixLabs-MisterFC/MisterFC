import { redirect } from 'next/navigation';

/** F14C-4 — La home del seguidor va directa a su agenda (nieto activo). */
export default async function SpectatorHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/spectator/agenda`);
}
