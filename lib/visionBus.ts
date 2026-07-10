/**
 * Module-level singleton event bus for vision alerts.
 *
 * camera.tsx emits HIGH-priority fused detections here.
 * navigation.tsx subscribes during an active route to inject
 * obstacle announcements into the TTS priority queue.
 *
 * No React dependency — can be imported anywhere.
 */

export type VisionAlert = {
  label: string;    // Russian label
  labelEn: string;  // English label
  priority: 'HIGH' | 'MEDIUM';
  timestamp: number; // Date.now()
};

type Subscriber = (alert: VisionAlert) => void;

const _subs = new Set<Subscriber>();

export const VisionBus = {
  emit(alert: VisionAlert): void {
    _subs.forEach((fn) => {
      try { fn(alert); } catch {}
    });
  },

  /**
   * Subscribe to vision alerts. Returns an unsubscribe function.
   * Always call the returned unsubscribe in a useEffect cleanup.
   */
  subscribe(fn: Subscriber): () => void {
    _subs.add(fn);
    return () => { _subs.delete(fn); };
  },
};
