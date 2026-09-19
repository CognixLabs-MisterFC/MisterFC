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

**Y el asunto cabe en 255 caracteres, sintaxis incluida.** Es un límite del
dashboard, no nuestro: con uno más largo contesta *«Failed to validate template:
subject: Too big»* y **no guarda nada**, ni el asunto ni el cuerpo. El primer
asunto ramificado medía 411 y se quedó sin pegar; el rechazo pasó desapercibido
hasta que `plantillas:diff` dijo que el dashboard seguía con la plantilla vieja.
Lo vigila el guard.

**Por eso el asunto de la invitación solo tiene dos ramas.** Cada
`{{ else if eq $k "..." }}` cuesta 27 de esos 255, así que las cinco no entran:

| tipo | asunto |
|---|---|
| `tutor` | «Te han invitado al club de tu hijo o hija» |
| `menor` | «Tu cuenta de MisterFC ya está lista» |
| `staff`, `admin`, `seguidor` | «Te han invitado a MisterFC» (rama neutra) |

`tutor` es el grupo más numeroso con diferencia (9 de las 15 invitaciones de
producción llevaban `player_id`), y `menor` es el único caso en el que «te han
invitado» no describe lo que pasó: a ese chaval no le invita nadie, su familia le
ha creado la cuenta. `staff` ya compartía texto con la rama neutra, así que no
pierde nada, y para `admin` y `seguidor` «te han invitado a MisterFC» es **cierto**
— lo que les explica quién les invita y a qué está en el cuerpo, que **sí**
conserva las cinco ramas y no tiene problema de tamaño.

**`invite` ramifica por `invite_kind`; `magic_link` NO.** En la invitación el
`data` lo ponemos nosotros al crear la cuenta. En el magic link no se crea
ninguna cuenta, así que `{{ .Data }}` sería el metadata **viejo** del
destinatario — el `invite_kind` de una invitación anterior. Un texto neutro y
cierto vale más que uno específico y mentiroso.

**La lista de tipos manda desde el código.** `INVITE_KINDS`
(`packages/core/src/invitations/invite-email-metadata.ts`). Si aparece un sexto,
su rama tiene que existir aquí **antes** de usarlo: sin ella el correo sale con
el texto neutro y nadie se entera. Eso lo vigila el guard.

## El dashboard no puede guardar la de invitación

Medido el 2026-09-19, y conviene saberlo antes de perder una tarde: **el
formulario del dashboard rechaza la plantilla de invitación**. Con el asunto
ramificado responde *«Failed to update email templates: failed to update Auth
config»*; con uno de más de 255, *«Too big»*. Un asunto de `1` lo guarda sin
problema, así que no es el tamaño ni el formulario en general: es la sintaxis de
plantilla en el asunto.

**La Management API sí la acepta.** Se probaron ocho variantes por la API —texto
plano, `{{ .Email }}`, `if/else`, declarar variable, `with .Data`, asignar dentro
del `with`, `.Data.x` directo y el asunto completo de 238— y **las ocho entran**.
GoTrue ejecuta el asunto como plantilla (v2.197,
`internal/mailer/templatemailer/template.go`); quien no lo admite es el
formulario.

Por eso hay un comando para aplicar. Sin él, esta carpeta sería un museo: la
copia no tendría forma de llegar a producción.

## Los tres comandos

```bash
pnpm check:plantillas-correo        # en CI. No habla con Supabase.
pnpm plantillas:diff                # a mano. Lee y compara. No escribe.
pnpm plantillas:aplicar invite      # ensayo: enseña qué cambiaría
pnpm plantillas:aplicar invite --si # lo aplica, y lo relee para verificarlo
```

`aplicar` va de una en una y exige `--si`. No corre en CI ni se dispara solo.

El guard comprueba la copia contra sí misma y contra `INVITE_KINDS`: que estén
los seis ficheros, que las acciones de Go template cierren, que `.Data` vaya
guardado, que la invitación tenga una rama por tipo más la neutra y que cada
plantilla use el enlace que le toca.

El diff es el que dice si el dashboard se ha movido, y **no corre en CI** porque
el workflow no tiene secretos (y así se queda). Conviene lanzarlo al tocar una
plantilla: una copia que nadie compara acaba siendo una copia que miente.
