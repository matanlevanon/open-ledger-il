import { Route, Routes } from 'react-router-dom';
import type { Me } from './api/client';
import { PreferencesProvider } from './app/preferences';
import { featureRoutes } from './features';
import { AppShell } from './layout/AppShell';
import { allNavPaths } from './layout/nav';
import { NotFound, Placeholder } from './pages/Placeholder';

interface AppProps {
  loadMe?: () => Promise<Me>;
}

export function App({ loadMe }: AppProps) {
  const registered = new Set(featureRoutes.map((r) => r.path.replace(/\/\*$/, '')));
  const placeholders = allNavPaths().filter((item) => !registered.has(item.path));

  return (
    <PreferencesProvider>
      <AppShell loadMe={loadMe}>
        <Routes>
          {featureRoutes.map(({ path, component: Screen }) => (
            <Route key={path} path={path} element={<Screen />} />
          ))}
          {placeholders.map((item) => (
            <Route key={item.path} path={item.path} element={<Placeholder titleKey={item.label} run={item.run} />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppShell>
    </PreferencesProvider>
  );
}
