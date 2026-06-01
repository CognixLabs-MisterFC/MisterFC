import { permanentRedirect } from 'next/navigation';

type Props = { params: Promise<{ locale: string }> };

/**
 * Bug AA (F6.10) — "Formaciones" salió de /perfil al menú lateral. Redirect 308
 * permanente para no romper bookmarks antiguos a /perfil/formaciones.
 */
export default async function PerfilFormacionesRedirect({ params }: Props) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/formaciones`);
}
