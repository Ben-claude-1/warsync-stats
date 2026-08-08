import { render } from './render.js';
import { LANG, i18nStart } from '../core/i18n.js';

// ====== INIT ======
document.documentElement.lang=LANG;
render();
i18nStart();
