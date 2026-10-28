import React from 'react';

export const PaletteIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="13.5" cy="6.5" r="3.5"></circle>
    <circle cx="17.5" cy="17.5" r="3.5"></circle>
    <circle cx="8.5" cy="12.5" r="3.5"></circle>
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.645-.213 2.5-.5"></path>
  </svg>
);
