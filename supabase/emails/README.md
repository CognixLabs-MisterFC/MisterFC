# Plantillas de correo (copia del repo)

Las plantillas que GoTrue manda de verdad **viven en el dashboard de Supabase**
(Authentication → Emails). Esta carpeta es la **copia revisada**: lo que debería
estar publicado. Existe para que haya rastro, para que un cambio se vea en un
diff y para que alguien pueda decir que no.

No es el origen de la verdad ni se despliega sola. Se pega a mano, a propósito.

**Hoy no hay ninguna plantilla propia.** Las tres que hubo están retiradas y la
carpeta solo guarda este documento. Que esté vacía es el estado correcto, y lo
vigila `check:plantillas-correo` con un censo de cero: si aparece un `*.html` o
un `*.subject.txt` sin su entrada en `TEMPLATES`, se pone rojo.

## Eran tres. Por qué no queda ninguna

`invite` y `magic_link` se **retiraron del dashboard** al cerrar Correo-B. No las
disparaba ya nadie: los siete senders de invitación crean la cuenta con
`auth.admin.createUser` —que no manda correo— y mandan el suyo por Resend, en el
idioma del destinatario; y `signInWithOtp`, que era quien usaba el magic link, no
aparece en ningún fichero del repo. Lo vigila `check:invite-senders`.

`recovery` era la última, y seguía viva por **calendario, no por diseño**: la web y
la app nueva piden su correo a `/api/auth/password-recovery`, que lo manda por
Resend, pero las versiones de la app ya instaladas llamaban a
`resetPasswordForEmail`, y ese camino usaba esta plantilla. La condición escrita
para retirarla era doble: que el build con las puertas nuevas estuviera fuera **y
que las viejas hubieran drenado**.

**Se retiró el 06-10-2026, con las dos mitades cumplidas y medidas:**

- Las dos apps están publicadas, y el build publicado es posterior a #675
  (21-09-2026), que es el que cambió las dos puertas nativas.
- Los únicos binarios anteriores al 21-09 eran de pruebas internas y TestFlight,
  todos de Jose. No había nadie más con una versión vieja instalada.
- En producción, `auth.users.recovery_sent_at` llevaba **quieta desde el
  2026-09-22** —catorce días— y su última actividad cae en la ventana 21-22/09,
  cuando aún no existía ningún binario nuevo y por fuerza todo lo instalado era
  viejo.

**Los dos instrumentos, con su letra pequeña**, por si hay que volver a medir algo
así: `recovery_sent_at` **no separa el camino viejo del nuevo**, porque
`admin.generateLink` sella la misma columna; y `password_recovery_attempts` tiene
**retención de 25 h**, así que su recuento es la última jornada y nunca un censo
histórico. Un 0 ahí no significa «nadie lo usa».

## Lo que se aprendió retirando las tres

**Una plantilla vacía NO hace que GoTrue caiga a la suya por defecto.** La
Management API no acepta `null` (400), así que lo único posible es dejar el
contenido en blanco —cadena vacía, que es como quedaron las tres— y entonces el
envío **falla**: HTTP 500, y en el caso de `invite` la cuenta ni se creaba.

Para un camino retirado eso es lo correcto: falla a la vista en vez de mandar algo
raro en silencio. El precio es que **quien siga en una versión vieja no recibe
nada y solo lo sabe él**, y por eso `recovery` esperó a que no quedara nadie ahí.

**`plantillas:aplicar` no retira: publica.** Lee el fichero del repo y lo sube. El
gesto de retirar es un PATCH del config de auth con la cadena vacía, a mano, como
se hizo las tres veces. No hay script para eso y no se ha hecho uno: es un gesto
raro, destructivo y que conviene pensar cada vez.

## Lo que hay que saber si alguna vuelve

Estas comprobaciones siguen en `check:plantillas-correo`, gobernadas por
`TEMPLATES`. Con la lista vacía no hacen nada; poniendo un nombre vuelven todas.
Lo que saben está medido y costó caro.

**El enlace.** `recovery` usaba `{{ .ConfirmationURL }}`, porque ahí el artefacto
de sesión **es** el trámite; `invite`, en cambio, acabó con `{{ .RedirectTo }}` al
arreglar el BUG 4. Cada plantilla declara el suyo en `ENLACE_OBLIGATORIO`. Que el
enlace lleve DIRECTO a `/{locale}/reset-password` lo sostiene `recoveryRedirectTo`
en core y lo vigila `check:correo-recuperacion`.

**`.Data` siempre dentro de `{{ with .Data }}`.** `auth.users.raw_user_meta_data`
es nullable y no tiene default. Con `.Data` nulo, `eq .Data.loquesea "x"` no cae
en la rama neutra: revienta el render y **el correo no se manda**.

**El asunto también es una plantilla.** Medido en GoTrue v2.197
(`internal/mailer/templatemailer/template.go`): se parsea con
`template.New("Subject")` y se ejecuta con el mismo mapa de datos que el cuerpo.

**Y el asunto cabe en 255 caracteres, sintaxis incluida.** Es un límite del
dashboard, no nuestro: con uno más largo contesta *«Failed to validate template:
subject: Too big»* y **no guarda nada**, ni el asunto ni el cuerpo. El primer
asunto ramificado medía 411 y se quedó sin pegar; el rechazo pasó desapercibido
hasta que `plantillas:diff` dijo que el dashboard seguía con la plantilla vieja.

**El formulario del dashboard no traga sintaxis de plantilla en el asunto.**
Medido el 2026-09-19 con la de invitación: respondía *«Failed to update email
templates»*. La **Management API sí la acepta** (se probaron ocho variantes y
entraron las ocho). Por eso existe `plantillas:aplicar`: sin él, esta carpeta
sería un museo.

## Los tres comandos

```bash
pnpm check:plantillas-correo          # en CI. No habla con Supabase.
pnpm plantillas:diff                  # a mano. Lee y compara. No escribe.
pnpm plantillas:aplicar <nombre>      # ensayo: enseña qué cambiaría
pnpm plantillas:aplicar <nombre> --si # lo aplica, y lo relee para verificarlo
```

Con la lista vacía, los dos últimos lo dicen y no hacen nada —`diff` ni siquiera
pide el token, porque no tiene sentido exigir un secreto para no comparar nada—.
`aplicar` va de una en una y exige `--si`. No corre en CI ni se dispara solo.

El diff es el que dice si el dashboard se ha movido, y **no corre en CI** porque el
workflow no tiene secretos (y así se queda). Conviene lanzarlo al tocar una
plantilla: una copia que nadie compara acaba siendo una copia que miente.
