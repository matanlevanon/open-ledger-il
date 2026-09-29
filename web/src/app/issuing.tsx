import { type ReactNode, createContext, useContext } from 'react';

/**
 * Whether this deployment issues documents (src/core/issuing.ts). Read from GET /api/me by the
 * app shell. When off, every create, finalize, pay, credit, cancel, duplicate and recurring
 * control is hidden. The server refuses those calls anyway.
 */
interface IssuingValue {
  issuing: boolean;
  setIssuing: (on: boolean) => void;
}

const IssuingContext = createContext<IssuingValue>({ issuing: true, setIssuing: () => undefined });

export function IssuingProvider({ value, children }: { value: IssuingValue; children: ReactNode }) {
  return <IssuingContext.Provider value={value}>{children}</IssuingContext.Provider>;
}

export function useIssuing(): boolean {
  return useContext(IssuingContext).issuing;
}

export function useSetIssuing(): (on: boolean) => void {
  return useContext(IssuingContext).setIssuing;
}
