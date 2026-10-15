import { z } from 'zod';

/**
 * Formulario de demo de la web comercial (spec §8): lo que se puede comprobar sin
 * servidor. La Server Action (`apps/web/src/app/[locale]/(web)/demo/actions.ts`) solo
 * lee el formulario, llama aquí y manda los correos.
 */

/** «Tu papel en el club» (§8.1). Los textos de cada opción viven en `messages-web`. */
export const DEMO_PAPELES = ['direccion', 'coordinacion', 'entrenador', 'otro'] as const;

/** «Número de equipos» (§8.1): 1-5 / 6-10 / 11-20 / Más de 20. */
export const DEMO_EQUIPOS = ['hasta5', 'de6a10', 'de11a20', 'masDe20'] as const;

/** Máximo del comentario (§8.1). */
export const DEMO_COMENTARIO_MAX = 500;

/**
 * Campo trampa. Va escondido en el formulario: una persona no lo ve ni lo rellena, un
 * robot que rellena todo lo que encuentra sí. Si llega con algo, se contesta como si
 * hubiera ido bien y no se manda nada.
 */
export const DEMO_TRAMPA = 'sitio_web';

/** Los campos que se pintan, en orden. La casilla de privacidad es el último. */
export const DEMO_CAMPOS = [
  'nombre',
  'papel',
  'club',
  'municipio',
  'equipos',
  'email',
  'telefono',
  'comentario',
  'privacidad',
] as const;
export type DemoCampo = (typeof DEMO_CAMPOS)[number];

/**
 * Una línea de texto. Sin caracteres de control: el nombre del club acaba en el asunto
 * del aviso al equipo, y un salto de línea ahí lo rompería. Desde el formulario no se
 * puede escribir uno; desde un POST a mano, sí.
 */
const linea = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\p{Cc}]*$/u);

export const demoSolicitudSchema = z.object({
  nombre: linea,
  papel: z.enum(DEMO_PAPELES),
  club: linea,
  municipio: linea,
  equipos: z.enum(DEMO_EQUIPOS),
  email: z.string().trim().max(254).email(),
  telefono: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+()\s.-]*$/),
  comentario: z.string().trim().max(DEMO_COMENTARIO_MAX),
  privacidad: z.literal('on'),
});
export type DemoSolicitud = z.infer<typeof demoSolicitudSchema>;

export type DemoLectura =
  | { estado: 'trampa' }
  | { estado: 'valida'; datos: DemoSolicitud }
  | { estado: 'invalida'; campos: DemoCampo[] };

/**
 * Lee el formulario. `leer(nombre)` devuelve lo que trae ese campo, o `null` si no
 * viene (una casilla sin marcar no viene). Los opcionales que no vienen cuentan como
 * vacíos.
 */
export function leerSolicitudDemo(leer: (campo: string) => string | null): DemoLectura {
  if ((leer(DEMO_TRAMPA) ?? '').trim() !== '') return { estado: 'trampa' };

  const r = demoSolicitudSchema.safeParse({
    nombre: leer('nombre') ?? '',
    papel: leer('papel') ?? '',
    club: leer('club') ?? '',
    municipio: leer('municipio') ?? '',
    equipos: leer('equipos') ?? '',
    email: leer('email') ?? '',
    telefono: leer('telefono') ?? '',
    comentario: leer('comentario') ?? '',
    privacidad: leer('privacidad'),
  });
  if (r.success) return { estado: 'valida', datos: r.data };

  const malos = new Set(r.error.issues.map((i) => String(i.path[0])));
  return { estado: 'invalida', campos: DEMO_CAMPOS.filter((c) => malos.has(c)) };
}

/**
 * Límite de envíos por clave (la IP) en una ventana deslizante, EN MEMORIA (§8.3: «5
 * envíos por IP y hora, en memoria, igual que en NIDO»).
 *
 * Es aproximado a propósito: cada instancia de la función lleva su contador, y un
 * arranque en frío lo pone a cero. Frena a quien repite desde un mismo sitio; no es una
 * defensa contra quien reparte el ataque. Para eso están el campo trampa y que el acuse
 * no lleve nada de lo que escribe el solicitante.
 */
export function crearLimitePorVentana({ max, ventanaMs }: { max: number; ventanaMs: number }) {
  const marcas = new Map<string, number[]>();

  return {
    /** Apunta un intento si cabe. Si no cabe, no lo apunta y dice cuánto falta. */
    intentar(
      clave: string,
      ahora: number = Date.now(),
    ): { ok: true } | { ok: false; esperaMs: number } {
      const vivas = (marcas.get(clave) ?? []).filter((t) => ahora - t < ventanaMs);
      if (vivas.length >= max) {
        marcas.set(clave, vivas);
        return { ok: false, esperaMs: (vivas[0] ?? ahora) + ventanaMs - ahora };
      }
      vivas.push(ahora);
      marcas.set(clave, vivas);

      // Que el mapa no crezca sin fin en una instancia que viva mucho.
      if (marcas.size > 5000) {
        for (const [k, ts] of marcas) {
          if (ts.every((t) => ahora - t >= ventanaMs)) marcas.delete(k);
        }
      }
      return { ok: true };
    },
  };
}
