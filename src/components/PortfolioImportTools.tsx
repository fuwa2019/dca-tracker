import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  Database as DatabaseIcon,
  FileCheck2,
  FileSpreadsheet,
  LoaderCircle,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { LOCAL_MODE } from '@/lib/localMode';
import { useCashflows } from '@/hooks/usePortfolio';
import { searchSymbols } from '@/lib/quote';
import { normalizeSymbol } from '@/lib/symbols';
import { classifySchwabSymbol, type SchwabSymbolClassification } from '@/lib/schwabTransactions';
import etfHoldings from '@/data/etf-holdings.json';
import { ledgerEventChip } from '@/lib/ledgerEvents';
import { buildReconciliation } from '@/lib/import/common.ts';
import {
  countLedgerEventKinds,
  detectPortfolioImportAdapter,
  retainedRowReasons,
  summarizeImportReceipt,
  type ImportMode,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportReconciliation,
  type ImportSource,
} from '@/lib/import/index.ts';
import type {
  Database,
  PortfolioLedgerImportResult,
} from '@/lib/database.types';

type TxnRow = Database['public']['Tables']['transactions']['Row'];

interface Props {
  transactions: TxnRow[];
}

interface FileInfo {
  name: string;
  size: number;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const KNOWN_ETF_SYMBOLS = new Set([
  ...Object.keys(etfHoldings.etfs),
  ...(etfHoldings._meta.cashLike ?? []),
].map((symbol) => normalizeSymbol(symbol)));

const SOURCE_LABELS: Record<ImportSource, string> = {
  schwab: 'Schwab',
  ibkr: 'IBKR',
  tradingview: 'TradingView',
};

const STATUS_META: Record<ImportPreviewRow['status'], { label: string; tone: StatusTone; icon: typeof Check }> = {
  import: { label: '导入', tone: 'ok', icon: CheckCircle2 },
  duplicate: { label: '重复', tone: 'info', icon: RefreshCw },
  ignore: { label: '忽略', tone: 'neutral', icon: Ban },
  block: { label: '阻止', tone: 'bad', icon: AlertTriangle },
};

export function PortfolioImportTools({ transactions }: Props) {
  const qc = useQueryClient();
  const { data: cashflows = [], isLoading: cashflowsLoading, isError: cashflowsError } = useCashflows();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>('append');
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [source, setSource] = useState<ImportSource | null>(null);
  const [classifications, setClassifications] = useState<Record<string, SchwabSymbolClassification>>({});
  const [classificationOverrides, setClassificationOverrides] = useState<Record<string, Exclude<SchwabSymbolClassification, 'unknown'>>>({});
  const [classifying, setClassifying] = useState(false);
  const classificationRunRef = useRef(0);
  const [parsing, setParsing] = useState(false);
  const [confirmScope, setConfirmScope] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<PortfolioLedgerImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const existingKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of transactions) {
      if (row.import_source && row.import_key) keys.add(`${row.import_source}|${row.import_key}`);
    }
    for (const row of cashflows) {
      if (row.import_source && row.import_key) keys.add(`${row.import_source}|${row.import_key}`);
    }
    return keys;
  }, [cashflows, transactions]);

  function keysForSource(nextSource: ImportSource): ReadonlySet<string> {
    return new Set(
      [...existingKeys]
        .filter((key) => key.startsWith(`${nextSource}|`))
        .map((key) => key.slice(nextSource.length + 1)),
    );
  }

  function clearState() {
    setFileInfo(null);
    setRawText(null);
    setPreview(null);
    setSource(null);
    classificationRunRef.current += 1;
    setClassifications({});
    setClassificationOverrides({});
    setClassifying(false);
    setMode('append');
    setConfirmScope(false);
    setResult(null);
    setError(null);
    setNotice(null);
    setParsing(false);
  }

  function rebuildPreview(nextMode: ImportMode) {
    if (!rawText || !source) return;
    const adapter = detectPortfolioImportAdapter({ text: rawText, fileName: fileInfo?.name });
    if (!adapter || adapter.source !== source) {
      setError('文件格式状态已失效，请重新选择文件。');
      return;
    }
    const nextPreview = adapter.audit(
      { text: rawText, fileName: fileInfo?.name },
      { mode: nextMode, existing_import_keys: keysForSource(source) },
    );
    setPreview(applyAssetPolicy(nextPreview, classifications, classificationOverrides));
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    clearState();
    setFileInfo({ name: file.name, size: file.size });
    if (file.size > MAX_FILE_BYTES) {
      setError('文件超过 5 MB，未读取。');
      return;
    }

    setParsing(true);
    const classificationRun = classificationRunRef.current + 1;
    classificationRunRef.current = classificationRun;
    try {
      const text = await file.text();
      const adapter = detectPortfolioImportAdapter({ text, fileName: file.name });
      if (!adapter) {
        setError('未识别到支持的 Schwab、IBKR 或 TradingView 文件格式。');
        return;
      }
      setRawText(text);
      setSource(adapter.source);
      const nextPreview = adapter.audit(
        { text, fileName: file.name },
        { mode: 'append', existing_import_keys: keysForSource(adapter.source) },
      );
      setPreview(nextPreview);
      const descriptions = new Map<string, string>();
      for (const transaction of transactions) {
        if (transaction.source_description) descriptions.set(normalizeSymbol(transaction.ticker), transaction.source_description);
      }
      for (const trade of nextPreview.trades) {
        if (trade.source_description) descriptions.set(normalizeSymbol(trade.ticker), trade.source_description);
      }
      const symbols = [...new Set(nextPreview.rows
        .filter((row) => row.item && ('side' in row.item || ('event_type' in row.item && !!row.item.ticker)))
        .map((row) => normalizeSymbol(row.item && 'ticker' in row.item ? row.item.ticker ?? '' : '')))].filter(Boolean);
      setClassifying(symbols.length > 0);
      const resolved = await resolveClassifications(symbols, descriptions);
      if (classificationRun === classificationRunRef.current) {
        setClassifications(resolved);
        setPreview(applyAssetPolicy(nextPreview, resolved, classificationOverrides));
      }
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : '文件读取失败。');
    } finally {
      if (classificationRun === classificationRunRef.current) setClassifying(false);
      setParsing(false);
    }
  }

  async function runImport() {
    if (!preview || !source || !canCommit || importing) return;
    if (LOCAL_MODE) {
      setNotice('本地演示模式只展示预览，不写入数据库。');
      return;
    }
    if (cashflowsLoading || cashflowsError) {
      setError('现有现金事件状态不可用，已阻止写入。');
      return;
    }

    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await supabase.rpc('import_portfolio_ledger', {
        p_source: source,
        p_trades: preview.trades,
        p_cash_events: preview.cash_events,
        p_mode: mode,
      });
      if (response.error) throw response.error;
      const nextResult = response.data as PortfolioLedgerImportResult | null;
      if (!nextResult) throw new Error('数据库未返回导入回执。');
      setResult(nextResult);
      setConfirmScope(false);
      setNotice('导入已提交，所有源行均在同一事务中处理。');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['transactions'] }),
        qc.invalidateQueries({ queryKey: ['cashflows'] }),
        qc.invalidateQueries({ queryKey: ['portfolio_history'] }),
        qc.invalidateQueries({ queryKey: ['performance_cache_status'] }),
        qc.invalidateQueries({ queryKey: ['performance_daily_pnl'] }),
        qc.invalidateQueries({ queryKey: ['tracked_symbol_coverage'] }),
        qc.invalidateQueries({ queryKey: ['price_coverage'] }),
        qc.invalidateQueries({ queryKey: ['daily_prices'] }),
        qc.invalidateQueries({ queryKey: ['quotes'] }),
      ]);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '导入失败，原有数据未改变。');
    } finally {
      setImporting(false);
    }
  }

  const canCommit = !!preview
    && preview.can_commit
    && preview.status_counts.import > 0
    && preview.errors.length === 0
    && !parsing
    && !classifying
    && !importing
    && (mode === 'append' || confirmScope);

  const sourceLabel = source ? SOURCE_LABELS[source] : '未识别来源';

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        title="打开统一导入预览"
        onClick={() => {
          setOpen(true);
          setNotice(null);
          setError(null);
        }}
      >
        <Upload className="h-4 w-4" />
        导入预览
      </Button>

      {(notice || error) && !open && (
        <p className={cn('max-w-sm text-right text-[11px]', error ? 'text-loss' : 'text-muted-foreground')}>
          {error ?? notice}
        </p>
      )}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setError(null);
            setConfirmScope(false);
          }
        }}
      >
        <DialogContent className="max-w-5xl min-w-0 overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DatabaseIcon className="h-5 w-5 text-brand" />
              统一导入预览
            </DialogTitle>
            <DialogDescription>
              文件只在此设备解析。确认前不会写入数据库，每一行都会显示导入、重复、忽略或阻止状态。
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <ImportReceipt result={result} preview={preview} notice={notice} onReset={() => {
              clearState();
              if (inputRef.current) inputRef.current.value = '';
            }} />
          ) : (
            <div className="min-w-0 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="portfolio-ledger-file">选择交易文件</Label>
                <input
                  ref={inputRef}
                  id="portfolio-ledger-file"
                  type="file"
                  className="sr-only"
                  accept=".csv,.tsv,text/csv,text/tab-separated-values"
                  aria-describedby="portfolio-ledger-file-help"
                  onChange={(event) => void handleFileChange(event)}
                />
                <label
                  htmlFor="portfolio-ledger-file"
                  className="group flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent/50 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground group-hover:text-foreground">
                    {parsing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {fileInfo?.name ?? '选择 Schwab、IBKR 或 TradingView 文件'}
                    </span>
                    <span id="portfolio-ledger-file-help" className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {fileInfo
                        ? `${formatBytes(fileInfo.size)} · ${sourceLabel}`
                        : '支持 CSV/Tab 分隔文件，最大 5 MB'}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-primary">
                    <Upload className="h-4 w-4" />
                    <span className="hidden sm:inline">{fileInfo ? '更换文件' : '选择文件'}</span>
                  </span>
                </label>
              </div>

              {preview && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <StatusBadge tone={preview.detection.supported ? 'ok' : 'bad'} dot>
                        {sourceLabel}
                      </StatusBadge>
                      <span className="truncate text-xs text-muted-foreground">{preview.format}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">表头第 {preview.detection.header_row ?? '未知'} 行</span>
                  </div>

                  <div className="space-y-2">
                    <Label>导入方式</Label>
                    <SegmentedControl
                      value={mode}
                      onChange={(nextMode) => {
                        setMode(nextMode);
                        setConfirmScope(false);
                        rebuildPreview(nextMode);
                      }}
                      name="portfolio-ledger-import-mode"
                      ariaLabel="选择导入方式"
                      className="w-full sm:w-auto"
                      options={[
                        { value: 'append', label: '新增导入' },
                        { value: 'replace_source', label: '替换此来源' },
                        { value: 'reset_all', label: '清空全部后导入' },
                      ]}
                    />
                    <p className="text-xs leading-5 text-muted-foreground">
                      {mode === 'append'
                        ? '只增加当前来源的新行，现有记录不变。'
                        : mode === 'replace_source'
                          ? `只删除并重建 ${sourceLabel} 的导入记录，手工记录和其他来源不受影响。`
                          : '删除当前用户全部交易、现金事件和资金批次后重建，必须再次确认。'}
                    </p>
                    {classifying && (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />正在确认证券类型，未知证券暂不允许写入。
                      </p>
                    )}
                  </div>

                  {preview.rows.some((row) => row.item && ('side' in row.item || ('event_type' in row.item && !!row.item.ticker))) && (
                    <AssetReview
                      rows={preview.rows}
                      classifications={classifications}
                      overrides={classificationOverrides}
                      disabled={classifying}
                      onChange={(ticker, classification) => {
                        const next = { ...classificationOverrides };
                        if (classification === 'unknown') delete next[ticker];
                        else next[ticker] = classification;
                        setClassificationOverrides(next);
                        setPreview(applyAssetPolicy(preview, classifications, next));
                      }}
                    />
                  )}

                  <StatusCounts preview={preview} />
                  <EventKindSummary rows={preview.rows} />
                  <ReconciliationSummary reconciliation={preview.reconciliation} />

                  {(preview.errors.length > 0 || preview.warnings.length > 0) && (
                    <div className="space-y-2" aria-live="polite">
                      {preview.errors.length > 0 && (
                        <div className="rounded-lg border border-loss/30 bg-loss-soft px-3 py-2.5 text-sm">
                          <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />阻止导入</div>
                          <ul className="mt-1.5 space-y-1 text-xs leading-5">
                            {preview.errors.slice(0, 8).map((message) => <li key={message}>{message}</li>)}
                          </ul>
                          {preview.errors.length > 8 && <p className="mt-1 text-xs">还有 {preview.errors.length - 8} 行阻止。</p>}
                        </div>
                      )}
                      {preview.warnings.length > 0 && (
                        <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm">
                          <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />需要留意</div>
                          <ul className="mt-1.5 space-y-1 text-xs leading-5">
                            {preview.warnings.slice(0, 6).map((message) => <li key={message}>{message}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  <ImportRows rows={preview.rows} />

                  {mode !== 'append' && (
                    <label className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm transition-colors',
                      confirmScope ? 'border-warn/50 bg-warn-soft' : 'border-border bg-surface-elevated hover:border-warn/40',
                    )}>
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-[hsl(var(--warn))]"
                        checked={confirmScope}
                        onChange={(event) => setConfirmScope(event.target.checked)}
                      />
                      <span>
                        {mode === 'replace_source'
                          ? `我确认只替换 ${sourceLabel} 的已有导入记录。`
                          : '我确认清空当前组合的全部交易、现金事件和资金批次后再导入。'}
                      </span>
                    </label>
                  )}

                  {error && <p className="text-xs text-loss" role="alert">{error}</p>}
                  {notice && <p className="text-xs text-muted-foreground" aria-live="polite">{notice}</p>}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    <p className="text-xs text-muted-foreground">
                      {LOCAL_MODE ? '本地演示模式不会写入数据库。' : '写入由认证 RPC 在同一事务中完成。'}
                    </p>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="ghost" onClick={clearState} disabled={importing}>重新选择</Button>
                      <Button
                        type="button"
                        disabled={!canCommit}
                        onClick={() => void runImport()}
                      >
                        {importing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
                        {importing ? '正在导入' : LOCAL_MODE ? '查看写入边界' : '确认并导入'}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusCounts({ preview }: { preview: ImportPreview }) {
  const items: Array<{ status: ImportPreviewRow['status']; label: string }> = [
    { status: 'import', label: '待导入' },
    { status: 'duplicate', label: '重复' },
    { status: 'ignore', label: '忽略' },
    { status: 'block', label: '阻止' },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
      {items.map(({ status, label }) => {
        const meta = STATUS_META[status];
        const Icon = meta.icon;
        return (
          <div key={status} className="min-w-0 bg-surface px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
            <div className="mt-1 font-num text-lg font-semibold">{preview.status_counts[status]}</div>
          </div>
        );
      })}
    </div>
  );
}

function EventKindSummary({ rows }: { rows: ImportPreviewRow[] }) {
  const counts = countLedgerEventKinds(rows, ['import', 'duplicate']);
  if (counts.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="portfolio-import-event-kinds-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="portfolio-import-event-kinds-title" className="text-sm font-semibold">事件类型构成</h3>
        <span className="text-xs text-muted-foreground">待导入与重复行</span>
      </div>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-2.5">
        {counts.map(({ kind, count }) => {
          const chip = ledgerEventChip(kind);
          return (
            <StatusBadge key={kind} tone={chip.tone} dot>
              {chip.label}
              <span className="font-num tabular-nums">{count}</span>
            </StatusBadge>
          );
        })}
      </div>
    </section>
  );
}

function ReconciliationSummary({ reconciliation }: { reconciliation: ImportReconciliation }) {
  const holdings = Object.entries(reconciliation.ending_shares);
  return (
    <section className="space-y-2" aria-labelledby="portfolio-import-reconciliation-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="portfolio-import-reconciliation-title" className="text-sm font-semibold">导入前对账</h3>
        <span className="text-xs text-muted-foreground">归一化账本合计</span>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        <ReconciliationMetric label="期末现金" value={`${reconciliation.ending_cash_usd} USD`} />
        <ReconciliationMetric label="外部入金" value={`${reconciliation.investor_inflows_usd} USD`} />
        <ReconciliationMetric label="外部流出" value={`${reconciliation.investor_outflows_usd} USD`} />
        <ReconciliationMetric label="证券数量" value={String(holdings.length)} />
      </div>
      {holdings.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-muted-foreground">
          {holdings.map(([ticker, shares]) => <span key={ticker}><strong className="font-num text-foreground">{ticker}</strong> {shares} 股</span>)}
        </div>
      )}
      {Object.entries(reconciliation.cash_by_kind).length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-muted-foreground">
          {Object.entries(reconciliation.cash_by_kind).map(([kind, amount]) => <span key={kind}><strong className="font-medium text-foreground">{kind}</strong> {amount} USD</span>)}
        </div>
      )}
    </section>
  );
}

function ReconciliationMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-num text-sm font-semibold" title={value}>{value}</div>
    </div>
  );
}

function ImportRows({ rows }: { rows: ImportPreviewRow[] }) {
  return (
    <section className="min-w-0 space-y-2" aria-labelledby="portfolio-import-rows-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="portfolio-import-rows-title" className="text-sm font-semibold">逐行结果</h3>
        <span className="text-xs text-muted-foreground">{rows.length} 行</span>
      </div>
      <div className="max-h-[18rem] min-w-0 overflow-auto rounded-lg border border-border">
        <div role="table" aria-label="导入逐行结果" className="text-xs">
          <div role="row" className="hidden grid-cols-[3.5rem_8rem_5rem_minmax(12rem,1fr)_minmax(10rem,1fr)] gap-2 border-b border-border bg-surface-elevated px-3 py-2 font-medium text-muted-foreground sm:grid">
            <span role="columnheader">行</span>
            <span role="columnheader">动作</span>
            <span role="columnheader">状态</span>
            <span role="columnheader">归一化值</span>
            <span role="columnheader">说明</span>
          </div>
          {rows.map((row) => <ImportRow key={`${row.source_index}-${row.action}-${row.reason ?? ''}`} row={row} />)}
        </div>
      </div>
    </section>
  );
}

function ImportRow({ row }: { row: ImportPreviewRow }) {
  const meta = STATUS_META[row.status];
  const Icon = meta.icon;
  const eventKind = row.item ? ('side' in row.item ? row.item.side : row.item.event_type) : null;
  return (
    <div role="row" className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 border-b border-border px-3 py-2.5 last:border-b-0 sm:grid-cols-[3.5rem_8rem_5rem_minmax(12rem,1fr)_minmax(10rem,1fr)] sm:items-center sm:gap-2">
      <span role="cell" className="tnum text-muted-foreground">{row.source_index || '文件'}</span>
      <span role="cell" className="min-w-0 truncate" title={row.action}>{row.action || '未知'}</span>
      <span role="cell"><StatusBadge tone={meta.tone} dot>{meta.label}</StatusBadge></span>
      <span role="cell" className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 leading-5 text-muted-foreground sm:col-span-1">
        {eventKind && (
          <StatusBadge tone={ledgerEventChip(eventKind).tone} className="shrink-0">
            {ledgerEventChip(eventKind).label}
          </StatusBadge>
        )}
        <span className="min-w-0 break-words tnum sm:truncate" title={itemSummary(row)}>{itemSummary(row)}</span>
      </span>
      <span role="cell" className={cn('col-span-2 min-w-0 break-words leading-5 sm:col-span-1', row.status === 'block' ? 'text-loss' : 'text-muted-foreground')}>
        {row.reason ?? '可写入'}
      </span>
      <Icon className="sr-only" aria-hidden="true" />
    </div>
  );
}

function itemSummary(row: ImportPreviewRow): string {
  const item = row.item;
  if (!item) return row.category === 'error' ? '无法归一化' : '未保留为 ETF 账本';
  if ('side' in item) {
    return `${item.ticker} ${item.shares} 股 · ${item.usd_amount} USD`;
  }
  return `${item.ticker ? `${item.ticker} · ` : ''}${item.usd_amount} USD`;
}

function ImportReceipt({
  result,
  preview,
  notice,
  onReset,
}: {
  result: PortfolioLedgerImportResult;
  preview: ImportPreview | null;
  notice: string | null;
  onReset: () => void;
}) {
  const summary = preview
    ? summarizeImportReceipt({
      result,
      status_counts: preview.status_counts,
      total_rows: preview.rows.length,
    })
    : null;
  const retainedReasons = preview ? retainedRowReasons(preview.rows) : [];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-base font-semibold"><CheckCircle2 className="h-5 w-5 text-gain" />导入回执</div>
      {notice && <p className="text-sm text-muted-foreground" aria-live="polite">{notice}</p>}

      {summary && (
        <section className="space-y-2" aria-labelledby="portfolio-import-receipt-summary-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="portfolio-import-receipt-summary-title" className="text-sm font-semibold">源文件行汇总</h3>
            <span className="text-xs text-muted-foreground">skipped 含 duplicates</span>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
            <ReceiptMetric label="已导入 imported" value={summary.imported} />
            <ReceiptMetric label="重复 duplicates" value={summary.duplicates} />
            <ReceiptMetric label="未写入 skipped" value={summary.skipped} />
            <ReceiptMetric label="源文件总行 total" value={summary.total} />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            源文件 {summary.total} 行中写入 {summary.imported} 行；其余 {summary.skipped} 行包含 {summary.duplicates} 行重复、
            {summary.ignored} 行按资产策略忽略、{summary.blocked} 行被阻止。四数由数据库回执与预览逐行状态推导，未改变 RPC 契约。
          </p>
        </section>
      )}

      <section className="space-y-2" aria-labelledby="portfolio-import-receipt-records-title">
        <h3 id="portfolio-import-receipt-records-title" className="text-sm font-semibold">写入的账本记录</h3>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
          <ReceiptMetric label="新增交易" value={result.transactions_added} />
          <ReceiptMetric label="新增现金事件" value={result.cashflows_added} />
          <ReceiptMetric label="重复保留" value={result.unchanged} />
          <ReceiptMetric label="移除记录" value={result.removed} />
        </div>
      </section>

      {retainedReasons.length > 0 && (
        <section className="space-y-2" aria-labelledby="portfolio-import-receipt-reasons-title">
          <h3 id="portfolio-import-receipt-reasons-title" className="text-sm font-semibold">未写入行的原因</h3>
          <p className="text-xs text-muted-foreground">这些行按原因保留展示，不做静默修正。</p>
          <ul className="max-h-40 space-y-1 overflow-auto rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs leading-5">
            {retainedReasons.slice(0, 20).map((entry) => (
              <li key={`${entry.source_index}-${entry.status}-${entry.reason}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="tnum text-muted-foreground">第 {entry.source_index} 行</span>
                <StatusBadge tone={STATUS_META[entry.status].tone} dot>{STATUS_META[entry.status].label}</StatusBadge>
                <span className={cn('min-w-0 break-words', entry.status === 'block' ? 'text-loss' : 'text-muted-foreground')}>
                  {entry.reason}
                </span>
              </li>
            ))}
          </ul>
          {retainedReasons.length > 20 && (
            <p className="text-xs text-muted-foreground">还有 {retainedReasons.length - 20} 行保留了原因文本。</p>
          )}
        </section>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" onClick={onReset}><RefreshCw className="h-4 w-4" />读取另一文件</Button>
      </div>
    </div>
  );
}

function applyAssetPolicy(
  preview: ImportPreview,
  classifications: Record<string, SchwabSymbolClassification>,
  overrides: Record<string, Exclude<SchwabSymbolClassification, 'unknown'>> = {},
): ImportPreview {
  const rows = preview.rows.map((row) => {
    if (!row.item) return row;
    const ticker = 'side' in row.item
      ? normalizeSymbol(row.item.ticker)
      : normalizeSymbol(row.item.ticker ?? '');
    if (!ticker) return row;
    const classification: SchwabSymbolClassification = overrides[ticker] ?? classifications[ticker] ?? 'unknown';
    if (classification === 'stock') {
      return {
        ...row,
        default_status: 'ignore' as const,
        status: 'ignore' as const,
        reason: '证券类型为个股，不属于单组合 ETF 账本。',
      };
    }
    if (classification === ('unknown' as SchwabSymbolClassification)) {
      return {
        ...row,
        default_status: 'block' as const,
        status: 'block' as const,
        reason: '无法确认这是美国 ETF，需完成资产确认后再导入。',
      };
    }
    return row;
  });
  const statusCounts: ImportPreview['status_counts'] = {
    import: 0,
    duplicate: 0,
    ignore: 0,
    block: 0,
  };
  for (const row of rows) statusCounts[row.status] += 1;
  const errors = rows
    .filter((row) => row.status === 'block')
    .map((row) => `第 ${row.source_index} 行：${row.reason ?? '无法导入'}`);
  const finalRows = rows.filter((row) => row.status === 'import' || row.status === 'duplicate');
  const trades = finalRows
    .filter((row): row is ImportPreviewRow & { item: ImportPreview['trades'][number] } => !!row.item && 'side' in row.item)
    .map((row) => row.item);
  const cash_events = finalRows
    .filter((row): row is ImportPreviewRow & { item: ImportPreview['cash_events'][number] } => !!row.item && 'event_type' in row.item)
    .map((row) => row.item);
  const reconciliation = buildReconciliation({ trades, cash_events });
  const baseWarnings = preview.warnings.filter((warning) => !warning.startsWith('按当前保留行计算的期末现金为'));
  const reconciliationWarnings = Number(reconciliation.ending_cash_usd) < -0.00000001
    ? [`按当前保留行计算的期末现金为 ${reconciliation.ending_cash_usd} USD，请检查遗漏的入金、提款或被忽略的现金事件。`]
    : [];
  return {
    ...preview,
    rows,
    trades,
    cash_events,
    reconciliation,
    warnings: [...baseWarnings, ...reconciliationWarnings],
    errors,
    can_commit: errors.length === 0 && statusCounts.import + statusCounts.duplicate > 0,
    status_counts: statusCounts,
  };
}

function AssetReview({
  rows,
  classifications,
  overrides,
  disabled,
  onChange,
}: {
  rows: ImportPreview['rows'];
  classifications: Record<string, SchwabSymbolClassification>;
  overrides: Record<string, Exclude<SchwabSymbolClassification, 'unknown'>>;
  disabled: boolean;
  onChange: (ticker: string, classification: SchwabSymbolClassification) => void;
}) {
  const tradeRows = rows.filter((row) => row.item && ('side' in row.item || ('event_type' in row.item && !!row.item.ticker)));
  const symbols = [...new Set(tradeRows
    .map((row) => {
      const item = row.item;
      return item && 'ticker' in item ? normalizeSymbol(item.ticker ?? '') : '';
    }))].filter(Boolean).sort();
  return (
    <section className="space-y-2" aria-labelledby="portfolio-import-assets-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="portfolio-import-assets-title" className="text-sm font-semibold">资产确认</h3>
        <span className="text-xs text-muted-foreground">{symbols.length} 个证券</span>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border">
        {symbols.map((ticker) => {
          const classification: SchwabSymbolClassification = overrides[ticker] ?? classifications[ticker] ?? 'unknown';
          return (
            <div key={ticker} className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:flex-nowrap">
              <span className="min-w-16 font-num text-sm font-semibold">{ticker}</span>
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {classification === ('unknown' as SchwabSymbolClassification) ? '未能从文件或行情源确认资产类型。' : classification === 'etf' ? '确认保留在 ETF 账本。' : '确认忽略个股交易。'}
              </span>
              <select
                aria-label={`${ticker} 资产类型`}
                value={classification}
                disabled={disabled}
                onChange={(event) => onChange(ticker, event.target.value as SchwabSymbolClassification)}
                className="h-9 min-w-24 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="unknown">待确认</option>
                <option value="etf">ETF，导入</option>
                <option value="stock">个股，忽略</option>
              </select>
            </div>
          );
        })}
      </div>
    </section>
  );
}

async function resolveClassifications(
  symbols: string[],
  descriptions: Map<string, string>,
): Promise<Record<string, SchwabSymbolClassification>> {
  const pairs = await Promise.all(symbols.map(async (rawTicker) => {
    const ticker = normalizeSymbol(rawTicker);
    const local = classifySchwabSymbol({
      ticker,
      description: descriptions.get(ticker),
      knownEtfSymbols: KNOWN_ETF_SYMBOLS,
    });
    if (local !== 'unknown') return [ticker, local] as const;
    try {
      const results = await searchSymbols(ticker);
      const exact = results.find((row) => normalizeSymbol(row.symbol) === ticker);
      return [ticker, classifySchwabSymbol({
        ticker,
        description: descriptions.get(ticker),
        knownEtfSymbols: KNOWN_ETF_SYMBOLS,
        providerType: exact?.type,
      })] as const;
    } catch {
      return [ticker, 'unknown'] as const;
    }
  }));
  return Object.fromEntries(pairs);
}

function ReceiptMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2.5">
      <div className="truncate text-xs text-muted-foreground" title={label}>{label}</div>
      <div className="mt-1 font-num text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
