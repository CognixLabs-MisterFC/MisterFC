import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

type DbClient = SupabaseClient<Database>;

/**
 * B-2 — El correo de invitación para quien YA TIENE CUENTA.
 *
 * `inviteUserByEmail` no puede invitar a una dirección que ya es usuario: eso es
 * lo que devuelve `email_exists`. Los siete senders salían entonces por
 * `resetPasswordForEmail`, elegido en su día como «vehículo de transporte» para
 * reutilizar el mismo `redirectTo` sin reimplementar nada. Funcionaba, pero el
 * correo que recibía esa persona era el de RESTABLECER LA CONTRASEÑA: asunto
 * equivocado, cuerpo equivocado, y una invitación disfrazada de incidencia de
 * seguridad. En producción salieron así 4 de las 15 invitaciones enviadas.
 *
 * Ahora sale por `signInWithOtp`, que usa la plantilla de MAGIC LINK — libre:
 * no hay un solo `signInWithOtp` de login en todo el repo, y la plantilla seguía
 * siendo el stub en inglés que trae GoTrue de fábrica. Su texto ya dice lo que
 * es: te han invitado, y ya tienes cuenta.
 *
 * LO QUE DE VERDAD IMPORTA DEL CORREO ES EL ENLACE, no el artefacto de sesión
 * que lleve dentro. `/invite/[token]` está escrito para funcionar SOLO con el
 * token —lo dice su propia cabecera— y para una cuenta preexistente
 * (`invited_user_id == null`) elige `SignInToAcceptForm`: entra con su
 * contraseña y el token le adjunta. Da igual que el `?code=` de PKCE no se
 * pueda canjear en el navegador del que recibe: esa rama nunca dependió de él.
 *
 * `shouldCreateUser: false` es obligatorio: aquí la cuenta YA existe. Crear una
 * es trabajo del otro camino, el que sí enlaza `invited_user_id`.
 *
 * POR QUÉ LA PLANTILLA DE MAGIC LINK NO RAMIFICA POR `invite_kind` (a
 * diferencia de la de invitación, A-1): `signInWithOtp` solo aplica `data` al
 * CREAR el usuario, y aquí no se crea ninguno. `{{ .Data }}` sería el metadata
 * viejo del destinatario — el `invite_kind` de una invitación ANTERIOR. Un
 * padre invitado una vez como cuerpo técnico recibiría el texto de cuerpo
 * técnico. Mejor un texto neutro y cierto que uno específico y mentiroso.
 */
export async function sendInviteToExistingUser(
  userSupabase: DbClient,
  args: { email: string; redirectTo: string }
): Promise<{ error: unknown | null }> {
  const { error } = await userSupabase.auth.signInWithOtp({
    email: args.email,
    options: {
      emailRedirectTo: args.redirectTo,
      shouldCreateUser: false,
    },
  });
  return { error: error ?? null };
}
