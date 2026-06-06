import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GpxGenerator } from './generator/GpxGenerator';
import './generator/gpx-generator.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GpxGenerator />
  </StrictMode>,
);
