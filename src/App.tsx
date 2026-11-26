import { useEffect } from 'react';
import { accountsEnabled, platformApiEnabled } from './config';
import { AppShell } from './components/AppShell';
import { I18nProvider } from './i18n';
import { account } from './account';
import { finishTelegramRedirect } from './components/SocialSignIn';
import { refreshCatalog } from './providers';
import { useRoute } from './router';
import { ConsoleScreen } from './screens/ConsoleScreen';
import { ConversationScreen } from './screens/ConversationScreen';
import { SignRecognitionScreen } from './screens/SignRecognitionScreen';
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
    case 'sign':
      return <SignRecognitionScreen />;
    case 'contribute':
      return platformApiEnabled ? <ContributeScreen /> : <HelpScreen />;
    case 'profile':
      return <ProfileScreen />;
    case 'help':
      return <HelpScreen />;
    case 'signin':
      return accountsEnabled ? <AuthScreen mode="signin" /> : <HelpScreen />;
    case 'register':
      return accountsEnabled ? <AuthScreen mode="register" /> : <HelpScreen />;
    case 'console':
      return <ConsoleScreen />;
    default:
      return <ConversationScreen />;
  }
}

export function App() {
  // Signs and phrases come from the API (v1 spec 2.2); the bundled seed covers offline use.
  useEffect(() => {
    if (platformApiEnabled) void refreshCatalog();
    // Restores a stored session; on a free host this also wakes the API before the user needs it.
    if (accountsEnabled) void finishTelegramRedirect().then(() => account.refresh());
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
