// src/context/BreakpointContext.tsx
import React, { createContext, useContext, useState, ReactNode } from 'react';

export type BreakpointsMap = Record<string, number[]>;

interface BreakpointContextType {
  breakpointsMap: BreakpointsMap;
  setBreakpointsMap: React.Dispatch<React.SetStateAction<BreakpointsMap>>;
}

const BreakpointContext = createContext<BreakpointContextType | undefined>(undefined);

export const BreakpointProvider = ({ children }: { children: ReactNode }) => {
  const [breakpointsMap, setBreakpointsMap] = useState<BreakpointsMap>({});
  return (
    <BreakpointContext.Provider value={{ breakpointsMap, setBreakpointsMap }}>
      {children}
    </BreakpointContext.Provider>
  );
};

export const useBreakpointContext = () => {
  const ctx = useContext(BreakpointContext);
  if (!ctx) throw new Error('useBreakpointContext must be used within BreakpointProvider');
  return ctx;
};
