'use client';

import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { DEMO_COMENTARIO_MAX, DEMO_TRAMPA, type DemoCampo } from '@misterfc/core';
import { solicitarDemo, type DemoFormState } from './actions';

/** Los textos llegan resueltos desde la página: los de la web comercial no viajan al navegador. */
export type DemoFormTextos = {
  campos: Record<DemoCampo, ReactNode>;
  opcional: string;
  elige: string;
  comentarioMax: string;
  papeles: { v: string; label: string }[];
  equipos: { v: string; label: string }[];
  enviar: string;
  enviando: string;
  errores: {
    resumen: string;
    requerido: string;
    email: string;
    telefono: string;
    comentario: string;
    privacidad: string;
    envio: ReactNode;
    limite: ReactNode;
  };
};

const campo =
  'mt-1 block w-full rounded-lg border bg-white px-3 py-2.5 text-base text-misterfc-navy shadow-sm focus:outline-2 focus:outline-offset-1 focus:outline-misterfc-green-ink';

export function DemoForm({ locale, textos }: { locale: string; textos: DemoFormTextos }) {
  const [state, action, pending] = useActionState<DemoFormState, FormData>(
    solicitarDemo.bind(null, locale),
    {},
  );
  // Al volver con un error, el foco va al aviso: en móvil queda por encima de la pantalla,
  // y así se ve y el lector de pantalla lo lee.
  const avisoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) avisoRef.current?.focus();
  }, [state]);
  const malos = new Set(state.campos ?? []);
  const v = state.valores ?? {};
  const e = textos.errores;

  const errorDe = (c: DemoCampo): string | null => {
    if (!malos.has(c)) return null;
    if (c === 'email' || c === 'telefono' || c === 'comentario' || c === 'privacidad') {
      return v[c] || c === 'privacidad' ? e[c] : e.requerido;
    }
    return e.requerido;
  };

  const etiqueta = (c: DemoCampo, opcional = false) => (
    <label htmlFor={`demo-${c}`} className="text-sm font-semibold text-misterfc-navy">
      {textos.campos[c]}
      {opcional && <span className="font-normal text-zinc-500"> ({textos.opcional})</span>}
    </label>
  );

  const aviso = (c: DemoCampo) => {
    const msg = errorDe(c);
    return msg ? (
      <p id={`demo-${c}-error`} className="mt-1 text-sm text-red-700">
        {msg}
      </p>
    ) : null;
  };

  const attrs = (c: DemoCampo) => ({
    id: `demo-${c}`,
    name: c,
    'aria-invalid': malos.has(c) || undefined,
    'aria-describedby': malos.has(c) ? `demo-${c}-error` : undefined,
    className: `${campo} ${malos.has(c) ? 'border-red-600' : 'border-zinc-300'}`,
  });

  const general =
    state.error === 'campos'
      ? e.resumen
      : state.error === 'limite'
        ? e.limite
        : state.error === 'envio'
          ? e.envio
          : null;

  return (
    // `key`: al volver con un error, el formulario se monta otra vez con lo escrito.
    <form key={JSON.stringify(v)} action={action} noValidate className="flex flex-col gap-5">
      {general && (
        <div
          ref={avisoRef}
          tabIndex={-1}
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800"
        >
          {general}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          {etiqueta('nombre')}
          <input
            {...attrs('nombre')}
            type="text"
            autoComplete="name"
            required
            maxLength={120}
            defaultValue={v.nombre}
          />
          {aviso('nombre')}
        </div>

        <div>
          {etiqueta('papel')}
          <select {...attrs('papel')} required defaultValue={v.papel ?? ''}>
            <option value="" disabled>
              {textos.elige}
            </option>
            {textos.papeles.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
          {aviso('papel')}
        </div>

        <div>
          {etiqueta('equipos')}
          <select {...attrs('equipos')} required defaultValue={v.equipos ?? ''}>
            <option value="" disabled>
              {textos.elige}
            </option>
            {textos.equipos.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
          {aviso('equipos')}
        </div>

        <div>
          {etiqueta('club')}
          <input
            {...attrs('club')}
            type="text"
            autoComplete="organization"
            required
            maxLength={120}
            defaultValue={v.club}
          />
          {aviso('club')}
        </div>

        <div>
          {etiqueta('municipio')}
          <input
            {...attrs('municipio')}
            type="text"
            autoComplete="address-level2"
            required
            maxLength={120}
            defaultValue={v.municipio}
          />
          {aviso('municipio')}
        </div>

        <div>
          {etiqueta('email')}
          <input
            {...attrs('email')}
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            defaultValue={v.email}
          />
          {aviso('email')}
        </div>

        <div>
          {etiqueta('telefono', true)}
          <input
            {...attrs('telefono')}
            type="tel"
            autoComplete="tel"
            maxLength={30}
            defaultValue={v.telefono}
          />
          {aviso('telefono')}
        </div>

        <div className="sm:col-span-2">
          {etiqueta('comentario', true)}
          <textarea
            {...attrs('comentario')}
            rows={4}
            maxLength={DEMO_COMENTARIO_MAX}
            defaultValue={v.comentario}
          />
          {aviso('comentario') ?? (
            <p className="mt-1 text-sm text-zinc-500">{textos.comentarioMax}</p>
          )}
        </div>
      </div>

      {/* Campo trampa: fuera de la vista, del tabulador y de los lectores de pantalla. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="demo-trampa">Web</label>
        <input id="demo-trampa" name={DEMO_TRAMPA} type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <div className="flex items-start gap-3">
          <input
            id="demo-privacidad"
            name="privacidad"
            type="checkbox"
            required
            defaultChecked={v.privacidad === 'on'}
            aria-invalid={malos.has('privacidad') || undefined}
            aria-describedby={malos.has('privacidad') ? 'demo-privacidad-error' : undefined}
            className="mt-1 h-4 w-4 shrink-0 accent-misterfc-green-ink"
          />
          <label htmlFor="demo-privacidad" className="text-sm text-zinc-700">
            {textos.campos.privacidad}
          </label>
        </div>
        {aviso('privacidad')}
      </div>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-lg bg-misterfc-green px-6 py-3 text-base font-semibold text-misterfc-navy hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-misterfc-green-ink disabled:opacity-60"
        >
          {pending ? textos.enviando : textos.enviar}
        </button>
      </div>
    </form>
  );
}
