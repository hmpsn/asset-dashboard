import { useEffect } from 'react';

// Redirects to the static v9 styleguide. Intentionally exits the SPA — the
// styleguide is a design reference doc with no auth requirement.
export function Styleguide() {
  useEffect(() => { window.location.replace('/styleguide.html'); }, []);
  return null;
}
