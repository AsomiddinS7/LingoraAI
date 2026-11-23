import { useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { I18nProvider } from './i18n';
import { account } from './account';
import { finishTelegramRedirect } from './components/SocialSignIn';
import { refreshCatalog } from './providers';
import { useRoute } from './router';
import { ConsoleScreen } from './screens/ConsoleScreen';
import { ConversationScreen } from './screens/ConversationScreen';
import { SignedSpeechScreen } from './screens/SignedSpeechScreen';
import { AuthScreen, ContributeScreen, HelpScreen, PhrasebookScreen, ProfileScreen, WelcomeScreen } from './screens/UserScreens';
import { CameraProvider } from './state/CameraContext';
import { ConversationProvider } from './state/ConversationContext';
import { SignWindowProvider } from './state/SignWindowContext';

function Screen() {
  switch (useRoute()) {
    case 'welcome':
      return <WelcomeScreen />;
    case 'phrasebook':
      return <PhrasebookScreen />;
    case 'presentation':
      return <SignedSpeechScreen />;
    case 'contribute':
      return <ContributeScreen />;
    case 'profile':
      return <ProfileScreen />;
    case 'help':
      return <HelpScreen />;
    case 'signin':
      return <AuthScreen mode="signin" />;
    case 'register':
      return <AuthScreen mode="register" />;
    case 'console':
      return <ConsoleScreen />;
    default:
      return <ConversationScreen />;
  }
}

export function App() {
  // Signs and phrases come from the API (v1 spec 2.2); the bundled seed covers offline use.
  useEffect(() => {
    void refreshCatalog();
    void finishTelegramRedirect().then(() => account.refresh());
  }, []);
  return (
    <I18nProvider>
      <CameraProvider>
        <ConversationProvider>
          <SignWindowProvider>
            <AppShell>
              <Screen />
            </AppShell>
          </SignWindowProvider>
        </ConversationProvider>
      </CameraProvider>
    </I18nProvider>
  );
}
