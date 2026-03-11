import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

/**
 * Lightweight hook that polls the unread notification count
 * every 60 seconds and exposes it for the sidebar badge.
 */
export function useNotifications() {
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const res = await api.get('/notifications/unread-count');
      setUnreadCount((res.data as { count: number }).count);
    } catch {
      // silently ignore — user might not be logged in yet
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => clearInterval(interval);
  }, [fetchCount]);

  return { unreadCount, refetchCount: fetchCount };
}
