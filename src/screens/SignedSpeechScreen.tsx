import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CameraPanel, type CameraController } from '../components/CameraPanel';
import { Chat, Composer } from '../components/Chat';
import { VideoExamples } from '../components/VideoExamples';
import { TtsNotice } from '../components/Notices';
import { Icon } from '../components/Icon';
import { SIGNED_SPEECH_ENTRIES, SIGNED_SPEECH_MODEL_URL, signedSpeechText } from '../data/signedSpeech';
import { useI18n } from '../i18n';
import { signedSpeechStore, useSignedSpeechVersion } from '../ml/signedSpeechStore';
import { MotionRecognizer } from '../recognition/motionRecognizer';
import type { RecognitionProgress, RecognitionResult } from '../recognition/types';
import { useCamera } from '../state/CameraContext';
import { useConversation } from '../state/ConversationContext';
import { initialWindow, windowReducer } from '../state/signWindow';

/** Camera inference against separately verified speech references. No scripted progression. */
export function SignedSpeechScreen() {
  const { lang } = useI18n();
  const say = (uz: string, en: string, ru: string) => lang === 'uz' ? uz : lang === 'ru' ? ru : en;
  const camera = useCamera();
  const conversation = useConversation();
  const latestConversation = useRef(conversation);
  latestConversation.current = conversation;
  const [win, dispatch] = useReducer(windowReducer, initialWindow);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [sent, setSent] = useState(false);
  const [generation, setGeneration] = useState(0);
  const version = useSignedSpeechVersion();
  const recognizer = useMemo(() => new MotionRecognizer({
    store: signedSpeechStore, modelUrl: SIGNED_SPEECH_MODEL_URL, maxRecordingMs: 20000,
  }), [generation]);
  const ensure = useCallback(() => {}, []);
  const cancel = useCallback(() => { recognizer.cancelWindow(); dispatch({ type: 'CANCEL' }); }, [recognizer]);

  useEffect(() => {
    let alive = true;
    setReady(false); dispatch({ type: 'LOADING' });
    recognizer.on('progress', (progress: RecognitionProgress) => {
      if (alive) dispatch({ type: 'PROGRESS', ...progress });
    });
    recognizer.on('result', (result: RecognitionResult) => {
      if (!alive) return;
      // Unknown dataset labels are never turned into prepared script text.
      const safeResult = signedSpeechText(result.label) ? result : { ...result, label: 'none' };
      dispatch({ type: 'RESULT', result: safeResult, threshold: 0 });
    });
    recognizer.on('error', (error: { message: string }) => { if (alive) dispatch({ type: 'ERROR', message: error.message }); });
    recognizer.load().then(() => {
      if (alive) { setReady(true); dispatch({ type: 'READY' }); }
    }, (error: unknown) => {
      if (alive) dispatch({ type: 'LOAD_FAILED', message: error instanceof Error ? error.message : String(error) });
    });
    return () => { alive = false; recognizer.detach(); recognizer.off(); };
  }, [recognizer]);
  useEffect(() => {
    if (!ready || !video) return;
    recognizer.attach(video);
    return () => recognizer.detach();
  }, [recognizer, ready, video]);
  useEffect(() => { cancel(); setSent(false); }, [version, cancel]);
  useEffect(() => () => {
    latestConversation.current.pttCancel(); latestConversation.current.cancelSpeech();
  }, []);
  useEffect(() => {
    if (win.phase !== 'recording' && win.phase !== 'processing') return;
    const timer = setTimeout(() => { recognizer.cancelWindow(); dispatch({ type: 'TIMEOUT' }); }, win.phase === 'recording' ? 21500 : 15000);
    return () => clearTimeout(timer);
  }, [win.phase, recognizer]);

  const controller: CameraController = { ensure, cancel, setVideo, win };
  const count = signedSpeechStore.all().length;
  const active = ['countdown', 'recording', 'processing'].includes(win.phase);
  const matchedText = win.outcome === 'recognized' && win.selected ? signedSpeechText(win.selected) : undefined;
  const conversationBusy = ['COMPOSING', 'SPEAKING', 'TRANSCRIBING', 'SIMPLIFYING'].includes(conversation.state.phase);
  const start = () => {
    if (!ready || !video || !count || active) return;
    setSent(false); dispatch({ type: 'START' }); recognizer.startWindow();
  };
  const accept = () => {
    if (!matchedText || sent || conversationBusy) return;
    latestConversation.current.speakDirect(matchedText, 'uz'); setSent(true);
  };

  return <div className="speech-page">
    <div className="screen-title"><h1>{say('Imo-ishoradan nutqqa', 'Signed speech recognition', 'Распознавание жестовой речи')}</h1></div>
    <p className="speech-intro">{say('Kamera harakatni tasdiqlangan video namunalari bilan solishtiradi. Har safar bitta to‘liq jumlani ko‘rsating.', 'The camera compares your movement with verified video examples. Sign one complete phrase per turn.', 'Камера сравнивает движения с проверенными видеообразцами. Показывайте по одной полной фразе.')}</p>
    <div className="talk">
      <section className="talk-signer">
        <div className="panel cam-panel">
          <div className="panel-head">
            <h2 className="panel-title"><Icon name="camera" />{say('Kamera kiritmasi', 'Camera input', 'Ввод с камеры')}</h2>
            <span className={`status-dot${camera.status === 'live' ? ' on' : ''}`}>{!ready ? say('Model yuklanmoqda', 'Loading model', 'Загрузка модели') : win.phase === 'recording' ? say('Yozilmoqda', 'Recording', 'Запись') : win.phase === 'processing' ? say('Solishtirilmoqda', 'Comparing', 'Сравнение') : camera.status === 'live' ? say('Tayyor', 'Ready', 'Готово') : say('Kamera oʻchiq', 'Camera off', 'Камера выкл.')}</span>
          </div>
          <div className="panel-body"><CameraPanel controller={controller} recognizedText={matchedText} /></div>
        </div>
        <div className="stage">
          {!count && <p className="notice info" role="status">{say('Bu nutq uchun tasdiqlangan namunalar hali yuklanmagan. Mavjud videodan jumla oralig‘ini tekshirib qo‘shing yoki tayyor namunalarni import qiling.', 'No verified references for this speech are loaded. Verify phrase intervals in the existing video or import labeled examples.', 'Проверенные образцы этой речи ещё не загружены. Проверьте фрагменты существующего видео или импортируйте примеры.')}</p>}
          <div className="btn-row">
            <button type="button" className="btn btn-primary btn-lg" disabled={!ready || camera.status !== 'live' || !count || active} onClick={start}>{say('Jumlani ko‘rsatish', 'Sign a phrase', 'Показать фразу')}</button>
            {win.phase === 'recording' && <button type="button" className="btn" onClick={() => recognizer.finishWindow()}>{say('Tugatish va aniqlash', 'Finish and recognize', 'Завершить и распознать')}</button>}
            {active && <button type="button" className="btn" onClick={cancel}>{say('Bekor qilish', 'Cancel', 'Отмена')}</button>}
          </div>
          {active && <p role="status">{win.phase === 'countdown' ? say('Tayyorlaning…', 'Get ready…', 'Приготовьтесь…') : win.phase === 'recording' ? say('Jumlani to‘liq ko‘rsating, so‘ng tugatishni bosing.', 'Sign the whole phrase, then press Finish.', 'Покажите полную фразу и нажмите «Завершить».') : say('Solishtirilmoqda…', 'Comparing…', 'Сравнение…')}</p>}
          {matchedText && <section className="card speech-result" aria-live="polite">
            <p className="eyebrow">{say('Namunaga mos jumla', 'Matched reference phrase', 'Фраза по совпавшему образцу')}</p>
            <p className="result-phrase" lang="uz">{matchedText}</p>
            <div className="meter-row" style={{ marginBottom: 14 }}>
              <span>{say('O‘xshashlik', 'Similarity', 'Сходство')}</span>
              <span className="meter" role="img" aria-label={`${Math.round((win.result?.confidence ?? 0) * 100)}%`}><span style={{ width: `${Math.round((win.result?.confidence ?? 0) * 100)}%` }} /></span>
              <strong>{Math.round((win.result?.confidence ?? 0) * 100)}%</strong>
            </div>
            <button type="button" className="btn btn-primary" disabled={sent || conversationBusy} onClick={accept}>{sent ? say('Suhbatga qo‘shildi', 'Added to conversation', 'Добавлено в разговор') : say('Tasdiqlash va ovozga aylantirish', 'Confirm and read aloud', 'Подтвердить и озвучить')}</button>
          </section>}
          <TtsNotice />
          {win.phase === 'result' && !matchedText && <p className="notice warn" role="status">{say('Ishonchli moslik topilmadi. Qayta ko‘rsating.', 'No reliable match. Try signing again.', 'Надёжное совпадение не найдено. Повторите жесты.')}</p>}
          {(win.phase === 'error' || win.phase === 'unavailable') && <div className="notice bad" role="alert"><p>{say('Aniqlash bajarilmadi. Kamerani va yuklangan namunalarni tekshiring.', 'Recognition failed. Check the camera and loaded examples.', 'Распознавание не удалось. Проверьте камеру и загруженные примеры.')}</p><button type="button" className="btn" onClick={() => setGeneration((value) => value + 1)}>{say('Qayta urinish', 'Retry', 'Повторить')}</button></div>}
          <p className="small muted">{say('Bu cheklangan namunalar bilan solishtirish demosidir. O‘xshashlik foizi tarjima aniqligi emas.', 'This is a limited reference-matching demo. Similarity is not translation accuracy.', 'Это ограниченная демонстрация сравнения образцов. Процент сходства не означает точность перевода.')}</p>
        </div>
      </section>
      <section className="talk-chat panel chat-panel" aria-labelledby="speech-chat-h">
        <div className="panel-head"><h2 className="panel-title" id="speech-chat-h"><Icon name="chat" />{say('Suhbat tarixi', 'Conversation history', 'История разговора')}</h2></div>
        <Chat /><Composer />
      </section>
    </div>
    <details className="card" style={{ marginTop: 24 }}>
      <summary>{say('Mavjud videodan nutq namunalarini tayyorlash', 'Prepare speech references from an existing video', 'Подготовить образцы из существующего видео')}</summary>
      <p>{say('Pastdagi jumlalar taniladigan natijalar emas, namunalarga beriladigan tasdiqlangan yorliqlardir. Har bir oralig‘ 0,3–20 soniya.', 'The phrases below are labels for verified references, not recognition results. Each interval must be 0.3–20 seconds.', 'Фразы ниже служат метками проверенных образцов, а не результатами распознавания. Длительность фрагмента: 0,3–20 секунд.')}</p>
      <VideoExamples store={signedSpeechStore} entries={SIGNED_SPEECH_ENTRIES} maxSeconds={20} />
    </details>
  </div>;
}
