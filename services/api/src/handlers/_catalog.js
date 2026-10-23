/**
 * Catalogo de licoes empacotado com a Lambda (gerado por `npm run catalog` a partir do
 * course.json do app). Substitui a antiga variavel COURSE_CATALOG_JSON, que nunca era
 * preenchida pela infra e nao cabe no limite de 4 KB de variaveis de ambiente.
 */

import catalog from '../content/catalog.js';

export const courseCatalog = catalog;
