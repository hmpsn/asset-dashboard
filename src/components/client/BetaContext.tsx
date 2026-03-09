import { createContext, useContext } from 'react';

const BetaContext = createContext(false);

export const BetaProvider = BetaContext.Provider;
export function useBetaMode() { return useContext(BetaContext); }
