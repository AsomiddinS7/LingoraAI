import { AppShell } from './components/AppShell';
import { I18nProvider } from './i18n';
import { useRoute } from './router';
import { AboutScreen } from './screens/AboutScreen';
import { ConsoleScreen } from './screens/ConsoleScreen';
import { PhrasesScreen } from './screens/PhrasesScreen';
import { SignScreen } from './screens/SignScreen';
import { SpeakScreen } from './screens/SpeakScreen';
import { WorkspaceScreen } from './screens/WorkspaceScreen';
import { CameraProvider } from './state/CameraContext';
import { ConversationProvider } from './state/ConversationContext';

function Screen() {
  switch (useRoute()) {
    case 'speak':
      return <SpeakScreen />;
    case 'phrases':
      return <PhrasesScreen />;
    case 'about':
      return <AboutScreen />;
    case 'conversation':
      return <WorkspaceScreen />;
    case 'console':
      return <ConsoleScreen />;
    default:
      return <SignScreen />;
  }
}

export function App() {
  return (
    <I18nProvider>
      <CameraProvider>
        <ConversationProvider>
          <AppShell>
            <Screen />
          </AppShell>
        </ConversationProvider>
      </CameraProvider>
    </I18nProvider>
  );
}
