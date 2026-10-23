const USER_ID_KEY = 'librax_userId';
const DISPLAY_NAME_KEY = 'librax_displayName';

export function getUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = 'usr-' + crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

export function getDisplayName(): string | null {
  return localStorage.getItem(DISPLAY_NAME_KEY);
}

export function setDisplayName(name: string): void {
  localStorage.setItem(DISPLAY_NAME_KEY, name.trim());
}

export function isOnboarded(): boolean {
  return !!localStorage.getItem(DISPLAY_NAME_KEY);
}
