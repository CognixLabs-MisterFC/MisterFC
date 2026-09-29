'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  createSupabaseBrowserClient,
  clubPartnerLogoObjectPath,
  groupPartnersByKind,
  PARTNER_KINDS,
  CLUB_PARTNER_LOGOS_BUCKET,
  CLUB_PARTNER_NAME_MAX,
  CLUB_PARTNER_TAGLINE_MAX,
  CLUB_PARTNER_URL_MAX,
  type ManagedClubPartner,
  type PartnerKind,
} from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * V-4 — la pantalla de gestión. Cliente, porque sube el fichero desde el navegador.
 *
 * LA SUBIDA VA DIRECTA A STORAGE y no por una Server Action, igual que el escudo del
 * club: un logo puede pesar hasta 2 MB y pasarlo por una action lo mete en el cuerpo
 * de la petición. La policy de Storage de V-1 es la que autoriza, y la ruta la
 * construye `clubPartnerLogoObjectPath` en core — la primera carpeta TIENE que ser el
 * club o Storage devuelve un 42501.
 *
 * ORDEN DE OPERACIONES EN EL ALTA: primero el logo, después la fila. `logo_path` es
 * NOT NULL, así que la fila no puede existir sin él; al revés haría falta un estado
 * intermedio «socio sin logo» que no queremos. La contrapartida es un objeto huérfano
 * si la fila falla, y V-1 ya lo asumió por escrito: es el logo de una empresa.
 *
 * `router.refresh()` tras cada acción: la lista la sirve el servidor y las actions
 * revalidan la ruta, así que no se mantiene un estado paralelo que pueda mentir.
 */
export function PartnersManager({
  clubId,
  initial,
}: {
  clubId: string;
  initial: ManagedClubPartner[];
}) {
  const t = useTranslations('partners');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const grupos = groupPartnersByKind(initial);

  function correr(fn: () => Promise<{ success?: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.error) {
        setError(t(claveDeError(r.error)));
        return;
      }
      setEditando(null);
      setCreando(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {PARTNER_KINDS.map((kind) => (
        <Card key={kind}>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">{t(kind)}</CardTitle>
            <span className="text-xs text-muted-foreground">
              {t('manage.count', { count: grupos[kind].length })}
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {grupos[kind].length === 0 ? (
              <p className="text-muted-foreground">{t('manage.empty')}</p>
            ) : (
              grupos[kind].map((p, i) => (
                <PartnerRow
                  key={p.id}
                  partner={p}
                  clubId={clubId}
                  primero={i === 0}
                  ultimo={i === grupos[kind].length - 1}
                  pending={pending}
                  editando={editando === p.id}
                  onEditar={() => setEditando(editando === p.id ? null : p.id)}
                  onCorrer={correr}
                  onError={setError}
                />
              ))
            )}
          </CardContent>
        </Card>
      ))}

      {creando ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('manage.new')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PartnerForm
              clubId={clubId}
              pending={pending}
              onCancelar={() => setCreando(false)}
              onCorrer={correr}
              onError={setError}
            />
          </CardContent>
        </Card>
      ) : (
        <Button type="button" variant="outline" onClick={() => setCreando(true)} disabled={pending}>
          <Plus className="size-4" aria-hidden />
          <span>{t('manage.new')}</span>
        </Button>
      )}
    </div>
  );
}

function PartnerRow({
  partner,
  clubId,
  primero,
  ultimo,
  pending,
  editando,
  onEditar,
  onCorrer,
  onError,
}: {
  partner: ManagedClubPartner;
  clubId: string;
  primero: boolean;
  ultimo: boolean;
  pending: boolean;
  editando: boolean;
  onEditar: () => void;
  onCorrer: (fn: () => Promise<{ success?: boolean; error?: string }>) => void;
  onError: (m: string | null) => void;
}) {
  const t = useTranslations('partners');
  const logoRef = useRef<HTMLInputElement | null>(null);
  const textosDeSubida = {
    mime: t('manage.error_mime'),
    tooLarge: t('manage.error_too_large'),
    upload: t('manage.error_upload'),
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2">
      <div className="flex items-center gap-3">
        {partner.logoUrl ? (
          // Igual que en el inicio: URL firmada de TTL corto, next/image la cachearía
          // por URL y serviría la firma caducada.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={partner.logoUrl} alt="" className="size-11 shrink-0 rounded-md object-contain" />
        ) : (
          <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-muted-foreground">
            {partner.name.trim().slice(0, 1).toUpperCase() || '·'}
          </span>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{partner.name}</span>
            {!partner.active && <Badge variant="secondary">{t('manage.retired')}</Badge>}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {partner.tagline ? `${partner.tagline} · ` : ''}
            {partner.url}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button" variant="ghost" size="icon" disabled={pending || primero}
            aria-label={t('manage.move_up')}
            onClick={() => onCorrer(async () => (await import('./actions')).movePartner(partner.id, 'up'))}
          >
            <ArrowUp className="size-4" aria-hidden />
          </Button>
          <Button
            type="button" variant="ghost" size="icon" disabled={pending || ultimo}
            aria-label={t('manage.move_down')}
            onClick={() => onCorrer(async () => (await import('./actions')).movePartner(partner.id, 'down'))}
          >
            <ArrowDown className="size-4" aria-hidden />
          </Button>

          <input
            ref={logoRef} type="file" accept={AVATAR_MIME_TYPES.join(',')} className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void subirYLuego(file, clubId, textosDeSubida, onError, (path) =>
                onCorrer(async () => (await import('./actions')).replacePartnerLogo(partner.id, path)),
              );
            }}
          />
          <Button
            type="button" variant="ghost" size="icon" disabled={pending}
            aria-label={t('manage.change_logo')} onClick={() => logoRef.current?.click()}
          >
            <ImagePlus className="size-4" aria-hidden />
          </Button>

          <Button type="button" variant="ghost" size="icon" disabled={pending} aria-label={t('manage.edit')} onClick={onEditar}>
            <Pencil className="size-4" aria-hidden />
          </Button>

          <Button
            type="button" variant="ghost" size="sm" disabled={pending}
            onClick={() => onCorrer(async () => (await import('./actions')).setPartnerActive(partner.id, !partner.active))}
          >
            {partner.active ? t('manage.retire') : t('manage.restore')}
          </Button>

          <Button
            type="button" variant="ghost" size="icon" disabled={pending} aria-label={t('manage.delete')}
            onClick={() => {
              // Borrar es definitivo y se lleva el logo: se pregunta. Para retirar sin
              // perder nada ya está el botón de al lado.
              if (!window.confirm(t('manage.delete_confirm', { name: partner.name }))) return;
              onCorrer(async () => (await import('./actions')).deletePartner(partner.id));
            }}
          >
            <Trash2 className="size-4 text-destructive" aria-hidden />
          </Button>
        </div>
      </div>

      {editando && (
        <PartnerForm
          clubId={clubId}
          pending={pending}
          inicial={partner}
          onCancelar={onEditar}
          onCorrer={onCorrer}
          onError={onError}
        />
      )}
    </div>
  );
}

function PartnerForm({
  clubId,
  pending,
  inicial,
  onCancelar,
  onCorrer,
  onError,
}: {
  clubId: string;
  pending: boolean;
  inicial?: ManagedClubPartner;
  onCancelar: () => void;
  onCorrer: (fn: () => Promise<{ success?: boolean; error?: string }>) => void;
  onError: (m: string | null) => void;
}) {
  const t = useTranslations('partners');
  const [kind, setKind] = useState<PartnerKind>(inicial?.kind ?? 'patrocinador');
  const [name, setName] = useState(inicial?.name ?? '');
  const [tagline, setTagline] = useState(inicial?.tagline ?? '');
  const [url, setUrl] = useState(inicial?.url ?? 'https://');
  const [file, setFile] = useState<File | null>(null);
  const esAlta = !inicial;
  const textosDeSubida = {
    mime: t('manage.error_mime'),
    tooLarge: t('manage.error_too_large'),
    upload: t('manage.error_upload'),
  };

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const datos = { kind, name, tagline, url };

    if (!esAlta) {
      onCorrer(async () => (await import('./actions')).updatePartner(inicial.id, datos));
      return;
    }
    // El alta necesita logo: la columna es NOT NULL.
    if (!file) {
      onError(t('manage.error_logo_required'));
      return;
    }
    void subirYLuego(file, clubId, textosDeSubida, onError, (path) =>
      onCorrer(async () => (await import('./actions')).createPartner(datos, path)),
    );
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex flex-wrap gap-2">
        {PARTNER_KINDS.map((k) => (
          <Button
            key={k} type="button" size="sm"
            variant={kind === k ? 'default' : 'outline'}
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
          >
            {t(k)}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`name-${inicial?.id ?? 'nuevo'}`}>{t('manage.field_name')}</Label>
        <Input
          id={`name-${inicial?.id ?? 'nuevo'}`} value={name} required
          maxLength={CLUB_PARTNER_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`tagline-${inicial?.id ?? 'nuevo'}`}>{t('manage.field_tagline')}</Label>
        <Input
          id={`tagline-${inicial?.id ?? 'nuevo'}`} value={tagline}
          maxLength={CLUB_PARTNER_TAGLINE_MAX}
          onChange={(e) => setTagline(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`url-${inicial?.id ?? 'nuevo'}`}>{t('manage.field_url')}</Label>
        <Input
          id={`url-${inicial?.id ?? 'nuevo'}`} value={url} required type="url"
          maxLength={CLUB_PARTNER_URL_MAX}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      {esAlta && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="logo-nuevo">{t('manage.field_logo')}</Label>
          <Input
            id="logo-nuevo" type="file" required accept={AVATAR_MIME_TYPES.join(',')}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          <span>{t('manage.save')}</span>
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancelar} disabled={pending}>
          {t('manage.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Los tres avisos que puede dar la subida, ya traducidos. */
type TextosDeSubida = { mime: string; tooLarge: string; upload: string };

/**
 * Valida el fichero, lo sube y solo entonces llama a la action con la ruta.
 *
 * Los límites son los del escudo del club (`AVATAR_*`): 2 MB y jpeg/png/webp. No se
 * admite SVG a propósito — un SVG es un documento con script, y esto lo sube alguien
 * de fuera del club por correo.
 *
 * Recibe las cadenas YA TRADUCIDAS y no el traductor: el `t` de next-intl tiene las
 * claves tipadas, y pasarlo con una firma genérica `(k: string) => string` no compila
 * (la variancia de `values` no encaja). Además así esta función no sabe nada de i18n.
 */
async function subirYLuego(
  file: File,
  clubId: string,
  textos: TextosDeSubida,
  onError: (m: string | null) => void,
  despues: (path: string) => void,
) {
  onError(null);
  if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
    onError(textos.mime);
    return;
  }
  if (file.size > AVATAR_MAX_BYTES) {
    onError(textos.tooLarge);
    return;
  }
  const ruta = clubPartnerLogoObjectPath(clubId, file.type);
  if (!ruta.ok) {
    onError(textos.mime);
    return;
  }

  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.storage
    .from(CLUB_PARTNER_LOGOS_BUCKET)
    .upload(ruta.path, file, { cacheControl: '3600', contentType: file.type, upsert: false });
  if (error) {
    onError(textos.upload);
    return;
  }
  despues(ruta.path);
}

/**
 * Los códigos que devuelven las actions, a CLAVE de traducción.
 *
 * Devuelve la clave y no el texto, y el mapa es `as const`, para que el tipo de
 * retorno sea la unión de claves literales que `t` de next-intl exige. Un mapa
 * `Record<string, string>` daría `string` y no compila.
 */
const claves = {
  kind: 'manage.error_kind',
  name: 'manage.error_name',
  tagline: 'manage.error_tagline',
  url: 'manage.error_url',
  logo_path: 'manage.error_upload',
  forbidden: 'manage.error_forbidden',
  not_found: 'manage.error_not_found',
  no_active_club: 'manage.error_generic',
  invalid: 'manage.error_generic',
} as const;

function claveDeError(code: string) {
  // Lo que no se reconoce cae en generic: un código nuevo en las actions da un
  // mensaje útil a medias, nunca la clave en crudo.
  return code in claves ? claves[code as keyof typeof claves] : 'manage.error_generic';
}
