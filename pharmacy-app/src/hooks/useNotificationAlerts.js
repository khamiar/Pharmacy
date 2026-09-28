import { useEffect, useState } from 'react';
import { catalogRequest } from '../services/catalogService';
export default function useNotificationAlerts(userId, enabled) {
  const [unread, setUnread] = useState(null),
    [alert, setAlert] = useState(null),
    [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let fetching = false,
      lastShown = 0, reminderTimer;
    const refresh = async () => {
      if (fetching || document.visibilityState === 'hidden') return;
      fetching = true;
      try {
        const data = await catalogRequest('notifications', {
          params: {
            limit: 1
          },
          signal: controller.signal
        });
        if (controller.signal.aborted) return;
        setUnread(data.unread);
        setError(false);
        const a = data.alerts;
        clearTimeout(reminderTimer);
        if (!a?.enabled) {
          setAlert(null);
          return;
        }
        const total = a.expiredBatches + a.expiringBatches + a.lowStockMedicines + a.outOfStockMedicines;
        if (!total) {
          setAlert(null);
          return;
        }
        const key = 'pharmacy-alert-last-' + userId;
        let last = lastShown;
        try {
          last = Math.max(last, Number(localStorage.getItem(key) || 0) || 0);
        } catch {}
        if (Date.now() - last >= a.intervalMinutes * 60000) {
          setAlert(a);
          lastShown = Date.now();
          last = lastShown;
          try {
            localStorage.setItem(key, String(lastShown));
          } catch {}
        }
        reminderTimer=setTimeout(refresh,Math.max(50,last+a.intervalMinutes*60000-Date.now()+20));
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        fetching = false;
      }
    };
    refresh();
    const timer = setInterval(refresh, 60000);
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('notifications-updated', refresh);
    window.addEventListener('pharmacy-profile-updated', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      clearInterval(timer);
      clearTimeout(reminderTimer);
      window.removeEventListener('notifications-updated', refresh);
      window.removeEventListener('pharmacy-profile-updated', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [userId, enabled]);
  return {
    unread,
    alert,
    error,
    dismiss: () => setAlert(null)
  };
}
