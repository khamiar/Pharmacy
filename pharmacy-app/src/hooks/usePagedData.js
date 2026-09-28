import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { catalogRequest, catalogError } from '../services/catalogService';
export default function usePagedData(resource, filters, refresh = 0) {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const {
    logout
  } = useAuth();
  const params = JSON.stringify(filters);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      catalogRequest(resource, {
        params: JSON.parse(params),
        signal: controller.signal
      }).then(result => {
        if (!controller.signal.aborted) setData(result);
      }).catch(err => {
        if (!controller.signal.aborted) {
          setError(catalogError(err));
          if (err.response?.status === 401) logout();
        }
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [resource, params, refresh, logout]);
  return {
    data,
    error,
    loading
  };
}
