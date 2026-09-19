# Plantillas de correo (copia del repo)

Las plantillas que GoTrue manda de verdad **viven en el dashboard de Supabase**
(Authentication → Emails). Esta carpeta es la **copia revisada**: lo que debería
estar publicado. Existe para que haya rastro, para que un cambio se vea en un
diff y para que alguien pueda decir que no.

No es el origen de la verdad ni se despliega sola. Se pega a mano, a propósito.

| fichero | qué es | cuándo sale |
|---|---|---|
| `invite.html` / `invite.subject.txt` | Invitación | `inviteUserByEmail` — el correo NO tiene cuenta todavía |
| `magic_link.html` / `magic_link.subject.txt` | Invitación a quien **ya tiene cuenta** | `signInWithOtp` (B-2), cuando `inviteUserByEmail` devuelve `email_exists` |
| `recovery.html` / `recovery.subject.txt` | Restablecer contraseña | `resetPasswordForEmail` — solo `/forgot-password` y el perfil de la app |

## Lo que hay que saber antes de tocarlas

**El enlace.** `invite` y `magic_link` usan `{{ .RedirectTo }}`, que lleva
DIRECTO a `/{locale}/invite/{token}`. No es un detalle de estilo: fue el arreglo
del BUG 4, y con `{{ .ConfirmationURL }}` el destino se perdía. `recovery` sí usa
`{{ .ConfirmationURL }}`, porque ahí el artefacto de sesión **es** el trámite.

**`.Data` siempre dentro de `{{ with .Data }}`.** `auth.users.raw_user_meta_data`
es nullable y no tiene default. Con `.Data` nulo, `eq .Data.loquesea "x"` no cae
en la rama neutra: revienta el render y **el correo no se manda**.

**El asunto también es una plantilla.** Medido en GoTrue v2.197
(`internal/mailer/templatemailer/template.go`): el asunto se parsea con
`template.New("Subject")` y se ejecuta con el mismo mapa de datos que el cuerpo.

**`invite` ramifica por `invite_kind`; `magic_link` NO.** En la invitación el
`data` lo ponemos nosotros al crear la cuenta. En el magic link no se crea
ninguna cuenta, así que `{{ .Data }}` sería el metadata **viejo** del
destinatario — el `invite_kind` de una invitación anterior. Un texto neutro y
cierto vale más que uno específico y mentiroso.

**La lista de tipos manda desde el código.** `INVITE_KINDS`
(`packages/core/src/invitations/invite-email-metadata.ts`). Si aparece un sexto,
su rama tiene que existir aquí **antes** de usarlo: sin ella el correo sale con
el texto neutro y nadie se entera. Eso lo vigila el guard.

## Los dos comandos

```bash
pnpm check:plantillas-correo   # en CI. No habla con Supabase.
pnpm plantillas:diff           # a mano. Lee el dashboard y compara. No escribe.
```

El guard comprueba la copia contra sí misma y contra `INVITE_KINDS`: que estén
los seis ficheros, que las acciones de Go template cierren, que `.Data` vaya
guardado, que la invitación tenga una rama por tipo más la neutra y que cada
plantilla use el enlace que le toca.

El diff es el que dice si el dashboard se ha movido, y **no corre en CI** porque
el workflow no tiene secretos (y así se queda). Conviene lanzarlo al tocar una
plantilla: una copia que nadie compara acaba siendo una copia que miente.
