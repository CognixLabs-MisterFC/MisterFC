import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * D-3 — los documentos legales de la PLATAFORMA, alcanzables siempre desde Perfil.
 *
 * POR QUÉ EXISTE, y no basta con el muro. El muro los enseña antes de pagar, que es lo
 * que exige el abogado. Pero el muro solo se ve cuando NO tienes acceso: `/suscripcion`
 * hace `redirect` a quien ya paga, y en la nativa el paywall solo se pinta si `blocked`.
 * O sea que en el instante en que alguien paga, deja de ver esos enlaces.
 *
 * Y el desistimiento son **catorce días DESDE la contratación**. Sin este bloque, el
 * documento estaría visible justo para quien todavía no puede ejercerlo, e invisible
 * para quien está en plazo. Perfil es la pantalla que comparten todos los roles y no la
 * tapa ningún muro, así que es el único sitio estable.
 *
 * NO es la sección de «Permisos»: aquélla enseña los textos POR CLUB que la familia
 * firmó (`legal_documents`, en la BD). Éstos son los del prestador, iguales para todos.
 * La nota del pie lo dice, porque dos bloques con la palabra «legal» se confunden.
 */
const SLUGS = ['privacidad', 'terminos', 'eliminacion-cuenta', 'desistimiento'] as const;

export async function LegalLinksCard({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'legal_publico.perfil' });

  // Las cuatro etiquetas se piden con la clave ESCRITA, no con `t(slug)`. El censo de
  // cadenas muertas solo reconoce literales y plantillas: con la variable, las cuatro
  // parecerían sin uso y el guard obligaría a borrarlas. Lo cazó él.
  const etiqueta: Record<(typeof SLUGS)[number], string> = {
    privacidad: t('privacidad'),
    terminos: t('terminos'),
    'eliminacion-cuenta': t('eliminacion-cuenta'),
    desistimiento: t('desistimiento'),
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {SLUGS.map((slug) => (
          <Link
            key={slug}
            href={`/${locale}/legal/${slug}`}
            className="text-sm text-misterfc-green underline underline-offset-4 hover:text-emerald-300"
          >
            {etiqueta[slug]}
          </Link>
        ))}
        <p className="mt-1 text-xs text-muted-foreground">{t('note')}</p>
      </CardContent>
    </Card>
  );
}
