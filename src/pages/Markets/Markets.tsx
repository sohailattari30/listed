import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { readAdvisorCache, writeAdvisorCache, type AdvisorCache } from '../../lib/advisorCache';
import { ACTION_LABELS, fetchAdvisor, fetchMarkets, formatPct, formatPrice, TREND_LABELS, type ZipView } from '../../lib/markets';
import styles from './Markets.module.css';

const trendClass = (t: ZipView['value_trend']) => (t === 'rising' ? styles.up : t === 'falling' || t === 'cooling' ? styles.down : '');

function WhyList({ title, items }: { title: string; items: { zip: string; city: string; why: string }[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <div className={styles.groupLabel}>{title}</div>
      {items.map((item) => (
        <div className={styles.why} key={item.zip}>
          <div className={styles.recZip}>
            {item.zip} · {item.city}
          </div>
          <div className={styles.recText}>{item.why}</div>
        </div>
      ))}
    </>
  );
}

function Analyst() {
  const [cache, setCache] = useState<AdvisorCache | null>(() => readAdvisorCache(localStorage));
  const run = useMutation({
    mutationFn: fetchAdvisor,
    onSuccess: (result) => setCache(writeAdvisorCache(localStorage, result)),
  });
  const result = cache?.result;
  const analysis = result?.analysis;

  return (
    <section className={styles.analyst}>
      <div className={styles.cardTop}>
        <div className={styles.label}>AI market analyst</div>
        {cache && (
          <button className={styles.link} disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? 'Running...' : 'Run again'}
          </button>
        )}
      </div>

      {run.error && (
        <div className={styles.err} role="alert">
          {run.error.message}
        </div>
      )}

      {result && analysis ? (
        <>
          <div className={styles.summary}>{analysis.summary}</div>

          {analysis.recommendations.length > 0 && (
            <>
              <div className={styles.groupLabel}>Where to call</div>
              {analysis.recommendations.map((r) => (
                <div className={styles.rec} key={r.zip}>
                  <span className={`${styles.badge} ${styles[r.action]}`}>{ACTION_LABELS[r.action]}</span>
                  <div>
                    <div className={styles.recZip}>
                      {r.zip} · {r.city}
                    </div>
                    <div className={styles.recText}>{r.reason}</div>
                  </div>
                </div>
              ))}
            </>
          )}

          <WhyList title="Selling the most homes" items={analysis.selling_most} />
          <WhyList title="Going down" items={analysis.going_down} />
          <WhyList title="Worth adding next" items={analysis.expansion_ideas} />

          {analysis.caveats.length > 0 && (
            <>
              <div className={styles.groupLabel}>Keep in mind</div>
              {analysis.caveats.map((c) => (
                <div className={styles.caveat} key={c}>
                  {c}
                </div>
              ))}
            </>
          )}

          {result.steps.length > 0 && (
            <div className={styles.steps}>
              <div className={styles.groupLabel} style={{ marginTop: 0 }}>
                What the analyst checked
              </div>
              {result.steps.map((s, i) => (
                <div className={styles.step} key={`${s.tool}-${i}`}>
                  {s.summary}
                </div>
              ))}
            </div>
          )}

          <div className={styles.meta}>
            Realtor.com {result.as_of.realtor} · Zillow {result.as_of.zillow} · written{' '}
            {new Date(cache.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
        </>
      ) : (
        <>
          <button className={styles.btn} disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? 'Analyst is researching...' : run.error ? 'Try again' : 'Analyze markets'}
          </button>
          <div className={styles.hint}>
            Finds where homes are selling fastest, which areas are cooling, and which zips are worth calling first. Takes about 20 seconds.
          </div>
        </>
      )}
    </section>
  );
}

function Row({ zip, sub, right, rightLabel, rightTone, extra, showSample = true }: { zip: ZipView; sub: string; right: string; rightLabel: string; rightTone?: string; extra?: ReactNode; showSample?: boolean }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.rowTitle}>
          {zip.zip} · {zip.city}
          {zip.callable && <span className={styles.mine}>In your app</span>}
          {showSample && zip.small_sample && <span className={styles.small}>Small sample</span>}
        </div>
        <div className={styles.rowSub}>{sub}</div>
      </div>
      <div className={styles.rowRight}>
        <div className={`${styles.big} ${rightTone ?? ''}`}>{right}</div>
        <div className={styles.bigLabel}>{rightLabel}</div>
        {extra}
      </div>
    </div>
  );
}

export function Markets() {
  const markets = useQuery({ queryKey: ['markets'], queryFn: fetchMarkets, staleTime: 60 * 60_000 });
  const data = markets.data;

  return (
    <div className={`shell fade ${styles.page}`}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          Where to
          <br />
          <em>call.</em>
        </h1>
        <div className={styles.sub}>{data ? `Bay Area housing data · ${data.as_of.realtor}` : 'Loading market data...'}</div>
      </div>

      <Analyst />

      {markets.error && (
        <div className={styles.section}>
          <div className={styles.err} role="alert">
            {markets.error.message}
          </div>
        </div>
      )}

      {data && (
        <>
          <section className={styles.section}>
            <div className={styles.sectionTitle}>Your markets</div>
            {data.your_markets.length === 0 ? (
              <div className={styles.empty}>No homeowner data in your app matches the Bay Area market data yet.</div>
            ) : (
              data.your_markets.map((z) => (
                <Row
                  key={z.zip}
                  zip={z}
                  sub={`${formatPrice(z.median_list_price)} median list · ${formatPct(z.pending_sales_yoy_pct)} pending sales vs last year · values ${formatPct(z.home_value_yoy_pct)}`}
                  right={z.listing_likelihood_score === null ? '–' : String(z.listing_likelihood_score)}
                  rightLabel="Listing score"
                  extra={<div className={`${styles.trend} ${trendClass(z.value_trend)}`}>{TREND_LABELS[z.value_trend]}</div>}
                />
              ))
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitle}>Selling fastest in the Bay Area</div>
            {data.hottest.map((z) => (
              <Row
                key={z.zip}
                zip={z}
                sub={`${z.pending_sales_last_3_months ?? '–'} homes under contract in 3 months · ${formatPct(z.pending_sales_yoy_pct)} vs last year · ${z.days_on_market ?? '–'} days on market`}
                right={`${Math.round(z.sell_through_pct ?? 0)}%`}
                rightLabel="Sell-through"
              />
            ))}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitle}>Home values falling</div>
            {data.falling.length === 0 ? (
              <div className={styles.empty}>No zips have lost value over the past year.</div>
            ) : (
              data.falling.map((z) => (
                <Row
                  key={z.zip}
                  zip={z}
                  sub={`${formatPrice(z.home_value)} typical value · last 3 months ${formatPct(z.home_value_3mo_pct)}`}
                  right={formatPct(z.home_value_yoy_pct)}
                  rightLabel="Past year"
                  rightTone={styles.down}
                  showSample={false}
                />
              ))
            )}
          </section>

          <div className={styles.footer}>
            Sources: {data.sources.realtor} ({data.as_of.realtor}); {data.sources.zillow} ({data.as_of.zillow}). Homes "selling" means pending sales (under contract), a stand-in for closed
            sales. The listing score blends sell-through, momentum, days on market and how long your homeowners have owned. It is a transparent heuristic, not a prediction.
          </div>
        </>
      )}
    </div>
  );
}
