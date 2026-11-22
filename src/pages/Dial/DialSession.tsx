import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { insertCall, insertSession } from '../../lib/api';
import type { HomeownerRow, Outcome } from '../../lib/database.types';
import { buildHistory, progressPercent, recordCall, streetOf, summarizeHistory, truePeopleSearchUrl, type CallHistory } from '../../lib/dial';
import { buildQueue, clearSnapshot, dailySeed, loadSnapshot, saveSnapshot, seededShuffle, type DialQueue } from '../../lib/queue';
import { Briefing } from './Briefing';
import styles from './Dial.module.css';

interface Props {
  userId: string;
  zip: string;
  city: string;
  homeowners: HomeownerRow[];
  calls: ReadonlyArray<{ homeowner_id: HomeownerRow['id']; outcome: Outcome }>;
}

const histDotClass = (tone: 'new' | 'called' | 'hot') => `${styles.histDot} ${tone === 'hot' ? styles.histHot : tone === 'called' ? styles.histCalled : ''}`;
const badgeClass = { sell: styles.loSell, vm: styles.loVm, no: styles.loNo } as const;

export function DialSession({ userId, zip, city, homeowners, calls }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<DialQueue>(() => buildQueue(homeowners, loadSnapshot(localStorage), zip));
  const [history, setHistory] = useState<Map<HomeownerRow['id'], CallHistory>>(() => buildHistory(calls));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const total = queue.owners.length;
  const owner = queue.owners[queue.cur];
  const finished = queue.cur >= total;

  async function log(outcome: Outcome) {
    if (!owner || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await insertCall(userId, owner.id, outcome);
    } catch {
      setError("Couldn't save that call. Check your connection and try again.");
      setSaving(false);
      busy.current = false;
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ['calls', userId] });
    setHistory((h) => recordCall(h, owner.id, outcome));

    const next: DialQueue = {
      ...queue,
      cur: queue.cur + 1,
      sells: queue.sells + (outcome === 'sell' ? 1 : 0),
      vms: queue.vms + (outcome === 'vm' ? 1 : 0),
      nos: queue.nos + (outcome === 'no' ? 1 : 0),
      hotLeads: outcome === 'sell' ? [...queue.hotLeads, owner] : queue.hotLeads,
    };
    setQueue(next);

    if (next.cur >= next.owners.length) {
      try {
        await insertSession(userId, next.cur, next.sells);
        void queryClient.invalidateQueries({ queryKey: ['sessions', userId] });
      } catch {
        // The calls themselves are saved; only the session summary row is missing.
      }
      clearSnapshot(localStorage);
    } else {
      saveSnapshot(localStorage, next);
    }
    setSaving(false);
    busy.current = false;
  }

  function goBack() {
    if (queue.cur === 0) return navigate('/today');
    const prev = { ...queue, cur: queue.cur - 1 };
    setQueue(prev);
    saveSnapshot(localStorage, prev);
  }

  function keepGoing() {
    clearSnapshot(localStorage);
    setQueue({ owners: seededShuffle(queue.owners, dailySeed(zip) + Date.now()), cur: 0, sells: 0, vms: 0, nos: 0, hotLeads: [] });
  }

  if (finished) {
    return (
      <div className={`shell ${styles.page}`}>
        <div className={styles.doneBody}>
          <div className={styles.doneNum}>{queue.cur}</div>
          <div className={styles.doneSub}>
            calls today.
            <br />
            Your territory knows you now.
          </div>
          <div className={styles.doneStats}>
            <div className={styles.stat}>
              <div className={`${styles.statNum} ${styles.statHot}`}>{queue.sells}</div>
              <div className={styles.statLabel}>Hot</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statNum}>{queue.vms}</div>
              <div className={styles.statLabel}>VM</div>
            </div>
            <div className={styles.stat}>
              <div className={`${styles.statNum} ${styles.statDim}`}>{queue.nos}</div>
              <div className={styles.statLabel}>No</div>
            </div>
          </div>
          {queue.hotLeads.length > 0 && (
            <div className={styles.doneHot}>
              <div className={styles.hotLabel}>Hot leads from today</div>
              {queue.hotLeads.map((h) => (
                <div className={styles.hotRow} key={h.id}>
                  <div>
                    <div className={styles.hotName}>{h.owner_name}</div>
                    <div className={styles.hotAddr}>{streetOf(h.address)}</div>
                  </div>
                  <span className="tag tag-hot">{h.years_owned}yr</span>
                </div>
              ))}
            </div>
          )}
          <div className={styles.doneActions}>
            <Link className="btn" to="/progress">
              See your progress
            </Link>
            <button className="btn-outline" style={{ marginTop: 10 }} onClick={keepGoing}>
              Keep calling
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!owner) return null;
  const summary = summarizeHistory(history.get(owner.id));
  const pct = progressPercent(queue.cur + 1, total);

  return (
    <div className={`shell ${styles.page}`}>
      <div className={styles.dialTop}>
        <button className={styles.backBtn} onClick={goBack}>
          <svg viewBox="0 0 16 16">
            <path d="M10 12L6 8l4-4" />
          </svg>
          <span>{queue.cur > 0 ? 'Previous' : 'Today'}</span>
        </button>
        <div className={styles.progRow}>
          <div className={styles.progLabel}>
            Call {queue.cur + 1} of {total}
          </div>
          <div className={styles.progPct}>{pct}%</div>
        </div>
        <div className={styles.progTrack}>
          <div className={styles.progFill} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className={styles.callBody} key={owner.id}>
        <div className={styles.eyebrow}>Now calling</div>
        <div className={styles.hist}>
          <div className={histDotClass(summary.tone)} />
          <div className={styles.histText}>{summary.text}</div>
        </div>
        <div className={styles.address}>
          <div className={styles.street}>{streetOf(owner.address)}</div>
          <div className={styles.meta}>
            {owner.owner_name} · {owner.years_owned}yr owner · {city || zip}
          </div>
          {summary.badge && <div className={`${styles.lastOutcome} ${badgeClass[summary.badge.kind]}`}>{summary.badge.text}</div>}
        </div>

        <Briefing key={owner.id} homeownerId={owner.id} />

        <a className={styles.tps} href={truePeopleSearchUrl(owner.address, owner.zip)} target="_blank" rel="noopener noreferrer">
          <div className={styles.phoneBlock}>
            <div>
              <div className={styles.phoneLabel}>Find phone number</div>
              <div className={styles.phoneText}>Search TruePeopleSearch →</div>
            </div>
            <div className={styles.phoneIcon}>
              <svg viewBox="0 0 24 24">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </div>
          </div>
        </a>

        <div className={styles.outcomes}>
          <button className={`${styles.obtn} ${styles.sell}`} disabled={saving} onClick={() => void log('sell')}>
            Wants to sell <span className={styles.arr}>→</span>
          </button>
          <button className={`${styles.obtn} ${styles.vm}`} disabled={saving} onClick={() => void log('vm')}>
            Voicemail <span className={styles.arr}>→</span>
          </button>
          <button className={`${styles.obtn} ${styles.no}`} disabled={saving} onClick={() => void log('no')}>
            Not interested <span className={styles.arr}>→</span>
          </button>
        </div>
        <button className={styles.skip} disabled={saving} onClick={() => void log('skip')}>
          Skip this number
        </button>
        {error && (
          <div className={styles.saveErr} role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
