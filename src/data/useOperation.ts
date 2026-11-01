import { useRef, useState } from 'react';

export function useOperation() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const run = async (operation: () => Promise<unknown>) => {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await operation();
      return true;
    } catch (cause) {
      console.error('Entity operation failed:', cause);
      setError(cause instanceof Error ? cause.message : 'Unable to save this change');
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { pending, error, run, clearError: () => setError('') };
}
