// Screen C: console (F10). Display only; values are supplied by the team.
// Also hosts the Plan A / Plan B switches and mock fixture picker for demos (U2, U7).
import { useCallback, useEffect, useState } from 'react';
import { FIXTURES } from '../api/fixtures';
import { ApiError } from '../api/client';
import { PLAN_A, PLAN_B, whichPlan, type AppConfig } from '../config';
import { Icon } from '../components/Icon';
import sample from '../data/console-sample.json';
import { VOCABULARY } from '../data';
import { useI18n, type MessageKey } from '../i18n';
import { backend, usesMockApi } from '../providers';
import { metrics, useMetrics } from '../pipeline/metrics';
import { TrainingCard } from '../components/TrainingCard';
import { delegate } from '../ml/handTracking';
import { evaluate } from '../ml/knn';
import { sampleStore, useSampleVersion } from '../ml/samples';
import { useMemo } from 'react';
import { runtime, useRuntime } from '../runtime';
import { useCamera } from '../state/CameraContext';
import { useConversation } from '../state/ConversationContext';
import type { FaceHint, HealthResponse, UsageResponse } from '../types';

const SELECTS: { key: keyof AppConfig; options: string[] }[] = [
  { key: 'sttProvider', options: ['typed-input', 'browser-speech', 'azure-speech'] },
  { key: 'ttsProvider', options: ['browser-synthesis', 'azure-speech'] },
  { key: 'llmProvider', options: ['azure-openai', 'mock'] },
  { key: 'signClassifier', options: ['mediapipe', 'mock', 'model'] },
  { key: 'dataCollection', options: ['consenting-teammates', 'tutor-confirmed'] },
];

export function ConsoleScreen() {
  const { t } = useI18n();
  return (
    <div>
      <div className="screen-title">
        <h1>{t('console.title')}</h1>
      </div>
      <p className="muted">{t('console.note')}</p>
      <div className="console-grid">
        <PerformanceCard />
        <SwitchesCard />
        <FixtureCard />
        <SimulateCard />
        <UsageCard />
        <EvaluationCard />
        <DataOrTraining />
        <RiskRegister />
      </div>
    </div>
  );
}

function PerformanceCard() {
  const { t } = useI18n();
  const m = useMetrics();
  const cadence = useRuntime((s) => s.demo.mockCadenceMs);
  const mock = m.classifier === 'mock';
  useSampleVersion();
  const ms = (x: number | null) => (x === null ? '—' : `${Math.round(x)} ms`);
  const num = (x: number | null, digits = 1) => (x === null ? '—' : x.toFixed(digits));
  return (
    <section className="card span-2" aria-labelledby="perf">
      <div className="card-title">
        <h2 id="perf">{t('perf.title')}</h2>
        <button type="button" className="btn" onClick={() => metrics.reset()}>
          <Icon name="refresh" />
          {t('perf.reset')}
        </button>
      </div>
      <div className={`notice ${mock ? 'warn' : 'info'}`} role="note" style={{ marginBottom: 12 }}>
        <Icon name={mock ? 'alert' : 'info'} />
        <p>
          {mock
            ? t('perf.mockWarning')
            : m.classifier === 'mediapipe'
              ? t('perf.realNote', { delegate: delegate ?? '…', n: sampleStore.all().length })
              : t('perf.modelNote')}
        </p>
      </div>
      <div className="kpis">
        <Kpi k={t('perf.cameraFps')} v={num(m.cameraFps)} />
        <Kpi k={t('perf.processedFps')} v={mock ? '—' : num(m.processedFps)} />
        <Kpi k={t('perf.processMs')} v={mock ? '—' : ms(m.avgProcessMs)} />
        <Kpi k={t('perf.skipped')} v={mock ? '—' : num(m.skippedPerSec)} />
        {!mock && <Kpi k={t('perf.recognition')} v={ms(m.avgRecognitionMs)} />}
        {m.classifier === 'mediapipe' && <Kpi k={t('perf.modelLoad')} v={ms(m.modelLoadMs)} />}
        <Kpi k={t('perf.latency')} v={m.avgLatencyMs === null ? '—' : `${m.avgLatencyMs.toFixed(1)} ms`} />
        <Kpi k={t('perf.interval')} v={ms(m.avgEventIntervalMs)} />
        <Kpi k={t('perf.events')} v={String(m.events)} />
        <Kpi k={t('perf.suppressed')} v={String(m.suppressed)} />
      </div>
      {mock && <p className="small muted" style={{ marginTop: 8 }}>{t('perf.noFrames')}</p>}
      {m.lastLatencyMs !== null && <p className="small muted">{t('perf.lastLatency', { ms: m.lastLatencyMs.toFixed(1) })}</p>}
      {mock && (
        <div className="field" style={{ marginTop: 12, maxWidth: 420 }}>
          <label htmlFor="cadence">{t('perf.cadence')}: {cadence}</label>
          <input
            id="cadence"
            type="range"
            min={500}
            max={3000}
            step={100}
            value={cadence}
            onChange={(e) => runtime.setDemo({ mockCadenceMs: Number(e.target.value) })}
          />
        </div>
      )}
    </section>
  );
}

function SwitchesCard() {
  const { t } = useI18n();
  const config = useRuntime((s) => s.config);
  const plan = whichPlan(config);
  return (
    <section className="card span-2" aria-labelledby="sw">
      <div className="card-title">
        <h2 id="sw">{t('console.switches')}</h2>
        <span className="badge plain">{t('console.current', { plan: plan === 'custom' ? t('badge.planCustom') : t('badge.plan', { plan }) })}</span>
      </div>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button type="button" className="btn btn-primary" onClick={() => runtime.setConfig(PLAN_A)} aria-pressed={plan === 'A'}>
          {t('console.planA')}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => runtime.setConfig(PLAN_B)} aria-pressed={plan === 'B'}>
          {t('console.planB')}
        </button>
        <button type="button" className="btn" onClick={() => runtime.resetConfig()}>
          <Icon name="refresh" />
          {t('console.reset')}
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="switch-table">
          <tbody>
            {SELECTS.map(({ key, options }) => (
              <tr key={key}>
                <th scope="row"><label htmlFor={`sw-${key}`}>{key}</label></th>
                <td>
                  <select id={`sw-${key}`} className="input" value={String(config[key])} onChange={(e) => runtime.setConfig({ [key]: e.target.value } as Partial<AppConfig>)}>
                    {options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {(['faceHints', 'mockAzure'] as const).map((key) => (
              <tr key={key}>
                <th scope="row">{key}</th>
                <td>
                  <label className="toggle">
                    <input type="checkbox" checked={config[key]} onChange={(e) => runtime.setConfig({ [key]: e.target.checked })} />
                    {config[key] ? t('common.on') : t('common.off')}
                  </label>
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row"><label htmlFor="sw-threshold">confidenceThreshold</label></th>
              <td>
                <input
                  id="sw-threshold"
                  className="input"
                  type="number"
                  min={0.5}
                  max={0.99}
                  step={0.01}
                  value={config.confidenceThreshold}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v >= 0.5 && v <= 0.99) runtime.setConfig({ confidenceThreshold: v });
                  }}
                  style={{ maxWidth: 140 }}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FixtureCard() {
  const { t } = useI18n();
  const fixture = useRuntime((s) => s.demo.fixture);
  const mock = useRuntime((s) => usesMockApi(s.config));
  return (
    <section className="card" aria-labelledby="fx">
      <h2 id="fx">{t('console.fixture')}</h2>
      <p className="small muted">{mock ? t('console.fixtureHelp') : t('console.fixtureOff')}</p>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={!mock}>
        <legend className="sr-only">{t('console.fixture')}</legend>
        {FIXTURES.map((f) => (
          <label key={f} className="toggle">
            <input type="radio" name="fixture" value={f} checked={fixture === f} onChange={() => runtime.setDemo({ fixture: f })} />
            {t(`fixture.${f}` as MessageKey)}
          </label>
        ))}
      </fieldset>
    </section>
  );
}

function SimulateCard() {
  const { t } = useI18n();
  const demo = useRuntime((s) => s.demo);
  const faceHintsOn = useRuntime((s) => s.config.faceHints);
  const conv = useConversation();
  const cam = useCamera();
  const hints: (FaceHint | null)[] = [null, 'eyebrows_raised', 'head_shake', 'head_nod'];

  return (
    <section className="card" aria-labelledby="sim">
      <h2 id="sim">{t('console.simulate')}</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={demo.simClassifierFail}
          onChange={(e) => {
            runtime.setDemo({ simClassifierFail: e.target.checked });
            conv.retryClassifier();
          }}
        />
        {t('console.sim.classifierFail')}
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={demo.simCameraDenied}
          onChange={(e) => {
            runtime.setDemo({ simCameraDenied: e.target.checked });
            cam.stop();
          }}
        />
        {t('console.sim.cameraDenied')}
      </label>
      <label className="toggle">
        <input type="checkbox" checked={demo.simOffline} onChange={(e) => runtime.setDemo({ simOffline: e.target.checked })} />
        {t('console.sim.offline')}
      </label>

      <h3 style={{ marginTop: 16 }}>{t('console.faceHints')}</h3>
      {!faceHintsOn && <p className="small muted">{t('console.faceHintsOff')}</p>}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={!faceHintsOn}>
        <legend className="sr-only">{t('console.faceHints')}</legend>
        {hints.map((h) => (
          <label key={h ?? 'none'} className="toggle">
            <input type="radio" name="facehint" checked={demo.faceHint === h} onChange={() => runtime.setDemo({ faceHint: h })} />
            {h ? t(`hint.${h}` as MessageKey) : t('console.hintNone')}
          </label>
        ))}
      </fieldset>
    </section>
  );
}

function UsageCard() {
  const { t } = useI18n();
  const config = useRuntime((s) => s.config);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.allSettled([backend.usage(), backend.health()]).then(([u, h]) => {
      setUsage(u.status === 'fulfilled' ? u.value : null);
      setHealth(h.status === 'fulfilled' ? h.value : { ok: false, mock: false });
      if (u.status === 'rejected') setError(u.reason instanceof ApiError ? u.reason.code : 'NETWORK');
      setLoading(false);
    });
  }, []);

  useEffect(refresh, [refresh, config.mockAzure, config.llmProvider]);
  const cost = (sample as { cost_per_1000_users: number | null }).cost_per_1000_users;

  return (
    <section className="card" aria-labelledby="usage" aria-busy={loading}>
      <div className="card-title">
        <h2 id="usage">{t('console.usage')}</h2>
        <button type="button" className="btn" onClick={refresh} disabled={loading}>
          {loading ? <div className="spinner" aria-hidden="true" /> : <Icon name="refresh" />}
          {t('console.usage.refresh')}
        </button>
      </div>
      {error && (
        <div className="notice bad" role="alert" style={{ marginBottom: 10 }}>
          <Icon name="alert" />
          <p>{t('console.usage.error')} ({error})</p>
        </div>
      )}
      <div className="kpis">
        <Kpi k={t('console.usage.session')} v={usage ? String(usage.calls_session) : '—'} />
        <Kpi k={t('console.usage.total')} v={usage ? String(usage.calls_total) : '—'} />
        <Kpi k={t('console.usage.cap')} v={usage ? String(usage.cap) : '—'} />
        <Kpi k={t('console.usage.mock')} v={usage ? (usage.mock ? t('common.yes') : t('common.no')) : '—'} />
      </div>
      <p style={{ marginTop: 12 }}>
        <strong>{t('console.usage.cost')}:</strong> {cost === null ? t('console.eval.awaiting') : cost}
      </p>
      <p className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <strong>{t('console.health')}:</strong>
        {health === null ? '—' : health.ok ? `✓ ${t('console.health.ok')}` : `✗ ${t('console.health.down')}`}
        {health?.mock && <span className="badge">{t('badge.mock')}</span>}
      </p>
    </section>
  );
}

function Kpi({ k, v }: { k: string; v: string }) {
  return (
    <div className="kpi">
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  );
}

type EvalData = {
  accuracy: number | null;
  interval: [number, number] | null;
  per_sign_recall: Record<string, number | null>;
  oov: { trials: number | null; rejected: number | null };
};

function EvaluationCard() {
  const { t, lang } = useI18n();
  const classifier = useRuntime((s) => s.config.signClassifier);
  const threshold = useRuntime((s) => s.config.confidenceThreshold);
  const version = useSampleVersion();
  const real = useMemo(
    () => (classifier === 'mediapipe' ? evaluate(sampleStore.all(), threshold) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [classifier, threshold, version],
  );
  const placeholder = (sample as unknown as { evaluation: EvalData }).evaluation;
  const ev: EvalData = real
    ? {
        accuracy: real.accuracy,
        interval: real.interval,
        per_sign_recall: real.perLabelRecall,
        oov: { trials: null, rejected: null },
      }
    : placeholder;
  const pct = (x: number) => Math.round(x * 100);
  return (
    <section className="card" aria-labelledby="eval">
      <div className="card-title">
        <h2 id="eval">{t('console.eval')}</h2>
        {!real && <span className="badge">{t('common.placeholder')}</span>}
      </div>
      {classifier === 'mediapipe' && (
        <p className="small muted">{real ? t('eval.loo', { takes: real.takes, frames: real.frames }) : t('eval.needMore')}</p>
      )}
      <div className="kpis">
        <div className="kpi">
          <div className="v">{ev.accuracy === null ? '—' : `${pct(ev.accuracy)}%`}</div>
          <div className="k">{real ? t('console.eval.accuracyLoo') : t('console.eval.accuracy')}</div>
          <div className="k">
            {ev.interval ? t('console.eval.interval', { lo: pct(ev.interval[0]), hi: pct(ev.interval[1]) }) : t('console.eval.awaiting')}
          </div>
          <div className="k">{t('console.eval.target')}</div>
        </div>
      </div>
      <h3 style={{ marginTop: 14 }}>{t('console.eval.recall')}</h3>
      <div className="bars">
        {VOCABULARY.map((v) => {
          const r = ev.per_sign_recall[v.label] ?? null;
          return (
            <div className="bar-row" key={v.label}>
              <span lang={lang}>{v.gloss[lang]}</span>
              <span className="track" aria-hidden="true"><span style={{ width: r === null ? 0 : `${pct(r)}%` }} /></span>
              <span>{r === null ? '—' : `${pct(r)}%`}</span>
            </div>
          );
        })}
      </div>
      <h3 style={{ marginTop: 14 }}>{t('console.eval.oov')}</h3>
      <p>
        {ev.oov.trials === null || ev.oov.rejected === null
          ? t('console.eval.awaiting')
          : t('console.eval.oovResult', { rejected: ev.oov.rejected, trials: ev.oov.trials })}
      </p>
    </section>
  );
}

function DataOrTraining() {
  const classifier = useRuntime((s) => s.config.signClassifier);
  return classifier === 'mediapipe' ? <TrainingCard /> : <DataCollectionCard />;
}

function DataCollectionCard() {
  const { t, lang } = useI18n();
  const policy = useRuntime((s) => s.config.dataCollection);
  const [label, setLabel] = useState(VOCABULARY[0]?.label ?? '');
  const [consent, setConsent] = useState(false);
  return (
    <section className="card" aria-labelledby="data">
      <h2 id="data">{t('console.data')}</h2>
      <p className="small muted">{t('console.data.policy', { policy })}</p>
      <div className="field">
        <label htmlFor="dc-label">{t('console.data.label')}</label>
        <select id="dc-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)}>
          {VOCABULARY.map((v) => (
            <option key={v.label} value={v.label}>{`${v.gloss[lang]} (${v.label})`}</option>
          ))}
        </select>
      </div>
      <label className="toggle" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        {t('console.data.consent')}
      </label>
      <div className="btn-row" style={{ marginTop: 8 }}>
        {/* TODO(team): wire the landmark data collection tool here. Display only until then. */}
        <button type="button" className="btn btn-primary" disabled>
          {t('console.data.record')}
        </button>
        <button type="button" className="btn" disabled>
          <Icon name="download" />
          {t('console.data.export')}
        </button>
      </div>
      <div className="notice info" style={{ marginTop: 12 }}>
        <Icon name="info" />
        <p>{t('console.data.notConnected')}</p>
      </div>
    </section>
  );
}

function RiskRegister() {
  const { t } = useI18n();
  const rows = [1, 2, 3, 4, 5, 6, 7];
  return (
    <section className="card span-2" aria-labelledby="risks">
      <h2 id="risks">{t('console.risks')}</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('console.risk')}</th>
              <th scope="col">{t('console.mitigation')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{t(`risk.${i}` as MessageKey)}</td>
                <td>{t(`risk.${i}.m` as MessageKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
