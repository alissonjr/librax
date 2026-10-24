import { createContext, useContext } from 'react';
import type { AdminApi } from './api';

/** Cliente da API para as telas (os testes e o modo de exemplo trocam por um falso). */
export const ApiContext = createContext<AdminApi | null>(null);

export function useApi(): AdminApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('ApiContext ausente');
  return api;
}
