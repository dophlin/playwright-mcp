type TabListener = (tabId: number) => void;

let onActiveTabChanged: TabListener | null = null;

export function registerRecordingActiveTabListener(fn: TabListener): void {
  onActiveTabChanged = fn;
}

export function notifyRecordingActiveTabChanged(tabId: number): void {
  onActiveTabChanged?.(tabId);
}
