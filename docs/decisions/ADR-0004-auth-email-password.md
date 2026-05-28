- **Status**: Accepted
- **Date**: 2026-05-28
- **Deciders**: Iker Milla
- **Related**: ADR-0001 (Supabase como backend), ADR-0002 (modelo de roles y capabilities), Fase 1 del Plan Maestro

# ADR-0004 — Email + contraseña como método de autenticación

## Context

Fase 1 se implementó con **magic link** como único método de autenticación (Supabase `signInWithOtp`). Quedaba implícito en ADR-0001 ("Auth nativo con magic link, sin Resend ni emails transaccionales propios") y materializado en `signinSchema` con solo el campo email.

Durante los smoke tests reales del flujo de invitación detectamos fricción inaceptable:

- **Latencia del email**: cada signin requiere abrir el cliente de correo y esperar la entrega. En tests iterativos esto añade 30–60 s por intento.
- **Misma sesión, otro dispositivo**: si el user pide el link desde el portátil y abre el email desde el móvil, el OTP redirige al móvil y el flow se rompe (la cookie de sesión queda en otro browser).
- **Spam/promociones**: varios providers filtran el email a carpetas que el user no revisa al instante.
- **Expectativa estándar**: un coach de fútbol amateur espera "correo + contraseña", no "te enviamos un enlace". La fricción percibida es alta cuando el patrón mental difiere del estándar.

La consecuencia es que el flow de invitación (admin envía → invitee recibe → click → onboarding) tarda varios minutos en el caso feliz y se atasca en el ~30% de intentos por las razones anteriores. Inaceptable para una beta cerrada que necesita iterar rápido con un club piloto real.

## Decision

**Email + contraseña como método principal de autenticación**. Magic link se elimina de los flows interactivos. Los emails de Supabase Auth se siguen usando como vehículo asíncrono (verificación de signup, reset de contraseña, invitación), pero ya no son el método de login en sí.

### Flows resultantes

| Pantalla                         | Método                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/signin`                        | `supabase.auth.signInWithPassword({ email, password })`                                                                                                           |
| `/signup`                        | `supabase.auth.signUp({ email, password, options: { data: { full_name, locale } } })` + email de verificación. `full_name` se pide en el form.                    |
| `/forgot-password`               | `supabase.auth.resetPasswordForEmail(email, { redirectTo: /reset-password })`                                                                                     |
| `/reset-password`                | `supabase.auth.updateUser({ password })` (asume sesión activa tras callback)                                                                                      |
| `/invite/{token}` (sin password) | `auth.admin.inviteUserByEmail` desde server. Al aceptar: `updateUser({ password, data })` + UPDATE `profiles SET full_name, date_of_birth, locale WHERE id = me`. |
| `/invite/{token}` (con password) | 1 click — solo INSERT en `memberships` y `accepted_at`. No se vuelve a pedir perfil (ya lo rellenó en su signup/invite original).                                 |

### Flujo de invitación

El admin invita → el server action:

1. Verifica permisos (`admin_club` o `coordinador` del club).
2. INSERT en `invitations` con token + expiración.
3. `auth.admin.inviteUserByEmail(email, { redirectTo, data: { invite_pending: true } })` con `redirectTo=/auth/callback?next=/invite/{token}`.
4. Si el user ya existía (otro club), `inviteUserByEmail` falla con `email_exists` → fallback a `resetPasswordForEmail` con el mismo `redirectTo`, reusando el flow ya existente sin tener que componer un email custom.

El invitee abre el email → callback canjea el OTP → llega a `/invite/{token}` con sesión. La page detecta `invite_pending` (o, si el metadato no se propagó, comprueba si tiene 0 memberships) y muestra el form para fijar contraseña. Al submit: `updateUser({ password })` + INSERT membership + marcar invitation como aceptada.

### Política de contraseñas

8 caracteres mínimo (límite por defecto de Supabase Auth). Sin requisitos de complejidad adicionales en Ola 1 — delegamos rate limiting y lockout en Supabase. Cuando entremos en Fase 14 (RGPD para menores) revisaremos la política.

### Datos de perfil capturados en signup / invite

Tanto signup público como aceptar invitación capturan los datos mínimos del perfil al mismo tiempo que la contraseña:

- **`full_name`** — obligatorio, 2–120 caracteres (coincide con el CHECK de `profiles.full_name`). Se propaga vía `raw_user_meta_data` en signup (el trigger `handle_new_user` lo lee) o vía UPDATE explícito en el flow de invitación (donde el trigger ya corrió cuando `inviteUserByEmail` creó la fila sin nombre).
- **`date_of_birth`** — opcional en signup y en invite. Validación: ISO `YYYY-MM-DD`, no futura, no anterior a 1900. Necesario para diferenciar menores en Fase 14 (RGPD); opcional en `profiles`, obligatorio en `players` (Fase 2).
- **`locale`** — no se pide al user. Se hereda del segmento `[locale]` activo de la URL (`es` / `en` / `va`). Editable luego en "Mi perfil" (Fase 2).

Razón de meterlo aquí y no en una pantalla posterior: evita una pantalla "completa tu perfil" extra entre el signin y el dashboard. Reducir el número de pasos del onboarding es el objetivo principal de este refactor.

### Service role en `packages/core`

Se añade `createSupabaseAdminClient()` con SECURITY DEFINER implícito vía service role. Vive en `packages/core/src/supabase/client-admin.ts` y se exporta también como path `@misterfc/core/supabase/admin` para señalar uso server-only. Lee `SUPABASE_SERVICE_ROLE_KEY` de `process.env` y lanza si falta.

## Consequences

### Positivas

- UX estándar y conocida. Cero fricción adicional por flow de OTP.
- Tests reales del flow de invitación bajan de varios minutos a ~30 s end-to-end.
- Mismo dispositivo, mismo browser: la sesión queda donde el user la inició.
- Recovery vía reset password sigue el patrón que el user ya espera de cualquier SaaS.
- El admin client unifica un patrón que otras fases reusarán (creación masiva de invitations, herramientas internas, scripts de mantenimiento).

### Negativas

- **Superficie de ataque mayor**: passwords débiles, reutilizadas o leakeadas son vector real. Mitigación: 8 caracteres mínimo + rate limiting nativo de Supabase + plan de añadir HIBP check o requisito de complejidad en Fase 14 si los logs muestran patrones débiles.
- **`SUPABASE_SERVICE_ROLE_KEY` ahora es dependencia operativa**. Tiene que estar en `.env.local` y en Vercel (Production + Preview). Si falta, el server action de invitaciones falla con error claro al primer intento. El admin client lanza early si no está presente.
- **Soporte de cuentas existentes** (mantenimiento): si en algún momento se reciben invites a emails que ya tienen cuenta sin password (caso histórico del periodo magic link), el fallback a `resetPasswordForEmail` los lleva al mismo flow de set-password sin distinción visible para el user. Aceptable.
- **2 emails posibles para el mismo user en signup + invite**: si el admin invita a un email recién registrado vía signup público antes de verificar, recibe la verificación de signup _y_ el invite. UX subóptima en un edge case raro; documentado, no se mitiga.

### Neutras

- El nombre del componente `LoginForm` y la ruta `/signin` siguen como están — el cambio es de método, no de URL.
- El callback `auth/callback/route.ts` sigue intercambiando OTP (lo siguen disparando reset password e invite); no cambia.
- `signinSchema` ahora exige `password` además de `email`; los tipos exportados desde `@misterfc/core` cambian (breaking en `packages/core` si algún consumidor externo dependía del schema antiguo, pero no hay consumidores fuera de `apps/web`).

## Alternatives considered

- **Mantener magic link como único método**: la baseline. Descartado por la fricción medida en smoke tests y porque bloquea iterar rápido con el club piloto.
- **Magic link + password como métodos paralelos**: añade superficie de UI (toggle "iniciar con enlace / con contraseña"), doble código de signin, doble template de email. Coste de mantenimiento sin ventaja real — si el user puede usar password, magic link se vuelve redundante. Descartado.
- **OAuth (Google / Apple) como tercer método**: aporta UX excelente pero introduce dependencia de cuenta Google/Apple y obliga a manejar el caso "el user invitado al club no tiene cuenta Google que coincida con el email del invite". Pospuesto a Ola 2 / Ola 3 si aparece demanda.
- **Passkeys (WebAuthn) vía Supabase**: técnicamente posible pero soporte aún irregular en navegadores Android antiguos del segmento amateur. Pospuesto.
- **Email transaccional propio (Resend) para invite y reset**: control total del template y la marca, pero introduce dependencia nueva, factura, y nuevo punto de fallo. No justificado en Ola 1 con un solo club piloto. Reevaluable cuando el volumen lo pida o cuando el template estándar de Supabase no encaje (p.ej. customización avanzada para cumplimiento RGPD de menores en Fase 14).
