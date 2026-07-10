// F14-13b — turndown-plugin-gfm no publica tipos. Declaración mínima de lo que
// usamos: el plugin `gfm` (tablas, tachado, etc.) que se pasa a TurndownService.use.
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}
