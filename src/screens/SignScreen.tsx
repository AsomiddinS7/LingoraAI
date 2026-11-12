// Screen A: phone sign to text.
import { CameraPanel } from '../components/CameraPanel';
import { InterpreterButton } from '../components/InterpreterButton';
import { ActionBar, SignControls, SignFlow } from '../components/SignFlow';
import { useI18n } from '../i18n';

export function SignScreen() {
  const { t } = useI18n();
  return (
    <div>
      <div className="screen-title">
        <h1>{t('nav.sign')}</h1>
      </div>
      <div className="sign-layout">
        <div className="stack">
          <CameraPanel />
        </div>
        <div className="stack">
          <SignControls />
          <SignFlow />
          <ActionBar />
          <InterpreterButton />
        </div>
      </div>
    </div>
  );
}
