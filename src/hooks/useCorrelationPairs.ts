import { useEffect, useState } from 'react';
import { CorrelationPair, fetchCorrelationPairs } from '@/lib/correlation';

/** Reads the correlation pairs from the database (single source of truth). */
export const useCorrelationPairs = () => {
  const [pairs, setPairs] = useState<CorrelationPair[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchCorrelationPairs().then(p => {
      if (!active) return;
      setPairs(p);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  return { pairs, loading };
};
