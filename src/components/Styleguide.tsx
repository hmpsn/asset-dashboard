import { useEffect } from 'react';

export function Styleguide() {
  useEffect(() => { window.location.replace('/styleguide.html'); }, []);
  return null;
}

export default Styleguide;
