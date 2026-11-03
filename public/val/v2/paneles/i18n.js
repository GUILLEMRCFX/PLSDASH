/**
 * El motor de idiomas, para los módulos del panel. El motor es un script
 * clásico compartido con la portada (`/i18n/idioma.js`); aquí se importa por su
 * efecto y se cargan los textos del panel. Ver la cabecera de aquel fichero.
 */
import '/i18n/idioma.js';
import { TEXTOS } from './textos.js';

const I = globalThis.plsI18n;
I.anadir(TEXTOS);

export const t = (clave, vars) => I.t(clave, vars);
export const idioma = () => I.idioma;
export const alCambiarIdioma = f => I.alCambiar(f);
export const traducirDom = raiz => I.traducirDom(raiz);
export const botonIdioma = clase => I.boton(clase);
