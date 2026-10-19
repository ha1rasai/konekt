// Teme pozadine (lista je u public/js/teme-podaci.js) i kategorije biznisa.
import { TEME } from "../public/js/teme-podaci.js";

export { TEME };
export const ID_TEMA = new Set(TEME.map((t) => t.id));

import { KATEGORIJE } from "../public/js/kategorije-podaci.js";

export { KATEGORIJE };
export const ID_KATEGORIJA = new Set(KATEGORIJE.map(([id]) => id));
