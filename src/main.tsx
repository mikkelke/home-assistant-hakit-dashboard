import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { addIcon } from '@iconify/react';
import { HOTPLATE_ICON, HOTPLATE_ICON_DATA } from './config/kitchenIcons';
import './index.css';
import App from './App.tsx';
import { startUpdateCheck } from './utils/updateCheck';

addIcon(HOTPLATE_ICON, HOTPLATE_ICON_DATA);

startUpdateCheck();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
