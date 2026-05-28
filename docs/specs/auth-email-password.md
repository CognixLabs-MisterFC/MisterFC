# Spec — Auth email + contraseña

> Refactor transversal de Fase 1 (subfases 1.5 y 1.6). No es una subfase nueva.
> Estado: ⟳ en curso
> Autor: Iker Milla
> Fecha de creación: 2026-05-28
> ADR asociado: [ADR-0004](../decisions/ADR-0004-auth-email-password.md)

---

## 1. Contexto

Magic link generaba fricción inaceptable en smoke tests reales del flow de invitación (ver ADR-0004). Refactorizamos el método de autenticación a email + contraseña sin tocar el modelo de datos ni las RLS existentes.

## 2. Objetivos

- Login con email + password en `/signin`.
- Signup público en `/signup` con verificación de email. Pide `full_name` además de email + password.
- Reset de contraseña vía `/forgot-password` + `/reset-password`.
- Flow de invitación adaptado: el invitee fija contraseña + datos mínimos de perfil (`full_name`, `date_of_birth` opcional) al aceptar.
- Eliminar toda referencia a magic link en código y en i18n.

## 3. Fuera de alcance

- OAuth (Google / Apple).
- MFA / passkeys / WebAuthn.
- Política de contraseñas avanzada (HIBP check, complejidad, expiración).
- Email transaccional propio (Resend).
- Cambios en el modelo de datos o RLS.
- UI multi-club (sigue siendo la del Fase 1).

## 4. Modelo de datos afectado

**Cero cambios en SQL.** La tabla `invitations` y las políticas existentes siguen sin tocar:

- `current_user_email()` sigue funcionando: tras el flow de invite, `user.email` coincide con `invitations.email` (Supabase Invite lo verifica).
- `memberships_insert_bootstrap_or_admin` sigue permitiendo el self-insert tras aceptar invitación, exactamente igual.
- `clubs_select_for_pending_invitees` sigue mostrando el club asociado a la invitación, sin cambios.
- `public.profiles` se rellena vía:
  - **Signup**: `raw_user_meta_data->>full_name` propagado por `supabase.auth.signUp({ options: { data: { full_name, locale } } })` y leído por el trigger `handle_new_user`.
  - **Invite**: el trigger crea la fila con `full_name=null` cuando `inviteUserByEmail` inserta en `auth.users` (porque no pasamos full_name ahí — lo desconocemos en ese momento). El server action `acceptInvitationWithProfile` hace UPDATE explícito de `full_name`, `date_of_birth`, `locale` con la sesión del invitee. La RLS de `profiles` permite al user actualizar su propia fila.

## 5. UI

Páginas nuevas: `/signup`, `/forgot-password`, `/reset-password`.
Páginas modificadas: `/signin` (form con password), `/invite/{token}` (form de set-password en rama nueva), `/check-email` (2 contextos: signup / reset).

Cada form sigue el patrón `useActionState` + Server Action con tipo `FormState`. Validación cliente puramente UX (mismatch de password); el server re-valida con Zod.

## 6. Estados, validaciones y errores

Schemas nuevos en `packages/core/src/schemas/auth.ts`:

- `signinSchema` — email + password.
- `signupSchema` — email + **full_name** + password + confirm (refine match).
- `forgotPasswordSchema` — email.
- `resetPasswordSchema` — password + confirm.
- `acceptInvitationWithProfileSchema` — **full_name + date_of_birth (opcional)** + password + confirm.

Helpers reutilizables a nivel módulo: `fullNameField` (trim, 2-120 chars), `dateOfBirthField` (acepta string ISO o null; rechaza futuras y < 1900).

Errores tipados por server action; el form decide qué mensaje pintar.

## 7. Tests

- **RLS (pgTAP)**: revisión de `supabase/tests/` sin cambios necesarios. El flow del invitee no altera la condición de las policies (email match).
- **Vitest**: pospuesto. No hay infra Vitest aún en el repo; el typecheck cubre los tipos por inferencia Zod. Cuando se introduzca Vitest, los schemas son candidatos prioritarios.
- **E2E (Playwright)**: pospuesto a Fase 14 según plan.

## 8. Notas de implementación

- `createSupabaseAdminClient()` añadido en `packages/core/src/supabase/client-admin.ts`. Server-only. Lee `SUPABASE_SERVICE_ROLE_KEY` y lanza si falta. Exportado como `@misterfc/core/supabase/admin` para que su uso se vea claro en imports.
- El callback `/auth/callback/route.ts` no cambia: sigue intercambiando OTP. Lo siguen disparando reset password e invite.
- Si `inviteUserByEmail` falla con `email_exists`, fallback automático a `resetPasswordForEmail` con el mismo `redirectTo`. Documentado en el action y en ADR-0004.
- `app_metadata.invite_pending` es el flag canónico para decidir si mostrar form de password en `/invite/{token}`. Fallback heurístico: si el user no tiene memberships, asumimos invitee fresco.

## 9. Configuración Supabase Auth (avisa al user para dashboard)

Antes de mergear este PR, el responsable debe verificar/aplicar en el dashboard de Supabase:

1. **Auth → Settings → Enable email confirmations**: ON. Sin esto, signup público no manda verificación y entra cualquier email sin validar.
2. **Auth → Email Templates**:
   - "Confirm signup" — el `{{ .ConfirmationURL }}` apunta a `/auth/callback` (default OK).
   - "Reset password" — `{{ .ConfirmationURL }}` apunta a `/auth/callback?next=/<locale>/reset-password` (lo construye el server action).
   - "Invite user" — `{{ .ConfirmationURL }}` apunta a `/auth/callback?next=/<locale>/invite/{token}` (lo construye el server action).
3. **Auth → URL Configuration**:
   - Site URL: el dominio de producción de Vercel.
   - Redirect URLs: añadir `https://<dominio>/auth/callback` y `https://<preview>.vercel.app/auth/callback` para previews.
4. **Email del remitente / SMTP**: verificar que el sender de Supabase Free funciona; si no, configurar SMTP propio.

## 10. Smoke tests del PR

Repetibles a mano tras deploy en preview:

| #   | Flow                                                                                                          | Esperado                                                           |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `/signup` con email nuevo → recibir email de verificación → click → callback → `/`                            | Sesión iniciada, redirigido a onboarding o home según memberships. |
| 2   | `/signin` con cuenta verificada                                                                               | Login OK, redirige a `/`.                                          |
| 3   | `/signin` con password incorrecto                                                                             | Error "Correo o contraseña incorrectos".                           |
| 4   | `/signin` con email no verificado                                                                             | Error "Aún no has verificado tu correo".                           |
| 5   | `/forgot-password` → email → click → `/reset-password` → nueva contraseña → `/signin`                         | Login con nueva contraseña OK.                                     |
| 6   | Admin invita email nuevo → invitee recibe → click → `/invite/{token}` con form (full_name, dob opcional, password, confirm) → submit | Membership creada, perfil rellenado, sesión activa, redirige a `/`. |
| 7   | Admin invita email ya registrado en otro club → invitee recibe → click → `/invite/{token}` sin form (1 click) | Membership creada en el club nuevo, redirige a `/`. Perfil no se vuelve a pedir. |
| 8   | `/signup` sin rellenar `full_name`                                                                            | Error de validación pintado en el form, no se llama a Supabase.    |

## 11. Cierre

Este refactor afecta a subfases 1.5 y 1.6 a la vez. Al cerrar este PR + verificar smoke tests, un PR aparte (`chore/mark-fase-1-done`) marcará la Fase 1 como ☑ completada en `docs/journey/progress.md`.
