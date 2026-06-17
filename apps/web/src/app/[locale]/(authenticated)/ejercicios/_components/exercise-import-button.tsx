'use client';

/**
 * F11.8 — Botón "Importar" del listado. Lee un JSON, lo parsea en cliente (error
 * claro si no es JSON) y llama a `importExercise`, que valida el envoltorio + cada
 * campo + el diagrama ANTES de crear. Éxito → ficha del nuevo borrador. Gateado
 * por autoría desde la page (la RLS es el gate real).
 */

import { useRef, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { importExercise } from '../actions';

export function ExerciseImportButton() {
  const t = useTranslations('ejercicios');
  const tForm = useTranslations('ejercicios.form');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function onPick(file: File) {
    startTransition(async () => {
      let json: unknown;
      try {
        json = JSON.parse(await file.text());
      } catch {
        toast.error(tForm('errors.invalid'));
        return;
      }
      const res = await importExercise(json);
      if (res.error) {
        toast.error(tForm(`errors.${res.error}`));
        return;
      }
      toast.success(t('toast.imported'));
      router.push(`/ejercicios/${res.id}`);
    });
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ''; // permite reimportar el mismo fichero
          if (f) onPick(f);
        }}
      />
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-4" aria-hidden />
        {t('actions.import')}
      </Button>
    </>
  );
}
