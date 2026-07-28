import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, Download, FileSpreadsheet, RotateCcw, Upload } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
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
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { LOCAL_MODE } from '@/lib/localMode';
import { searchSymbols } from '@/lib/quote';
import { normalizeSymbol } from '@/lib/symbols';
import {
  buildSchwabDepositImportDiff,
  buildSchwabImportDiff,
  classifySchwabSymbol,
  exportSchwabTransactions,
  isSchwabDepositAction,
  parseSchwabTransactions,
  type SchwabImportKind,
  type SchwabImportRow,
  type SchwabDepositImportRow,
  type SchwabParseResult,
  type SchwabSymbolClassification,
} from '@/lib/schwabTransactions';
import { useCashflows } from '@/hooks/usePortfolio';
import etfHoldings from '@/data/etf-holdings.json';
import type {
  Database,
  SchwabTransactionImportResult,
} from '@/lib/database.types';

type TxnRow = Database['public']['Tables']['transactions']['Row'];
type ImportMode = 'append' | 'reset_all';

interface Props {
  transactions: TxnRow[];
}

interface FileInfo {
  name: string;
  size: number;
}

const KNOWN_ETF_SYMBOLS = new Set([
  ...Object.keys(etfHoldings.etfs),
  ...(etfHoldings._meta.cashLike ?? []),
].map((symbol) => normalizeSymbol(symbol)));

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function SchwabTransactionTools({ transactions }: Props) {
  const qc = useQueryClient();
  const {
    data: cashflows = [],
    isLoading: cashflowsLoading,
    isError: cashflowsError,
  } = useCashflows();
  const inputRef = useRef<HTMLInputElement>(null);
  const classificationRunRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>('append');
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [parsed, setParsed] = useState<SchwabParseResult | null>(null);
  const [classifications, setClassifications] = useState<Record<string, SchwabSymbolClassification>>({});
  const [manualEtfs, setManualEtfs] = useState<Set<string>>(new Set());
  const [kinds, setKinds] = useState<Record<string, SchwabImportKind>>({});
  const [classifying, setClassifying] = useState(false);
  const [resetCoverageConfirmed, setResetCoverageConfirmed] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<SchwabTransactionImportResult | null>(null);

  const allSymbolDescriptions = useMemo(() => {
    const descriptions = new Map<string, string>();
    for (const transaction of transactions) {
      const ticker = normalizeSymbol(transaction.ticker);
      if (transaction.source_description) descriptions.set(ticker, transaction.source_description);
    }
    for (const row of parsed?.rows ?? []) {
      if (row.source_description) descriptions.set(row.ticker, row.source_description);
    }
    return descriptions;
  }, [parsed?.rows, transactions]);

  const symbolUniverse = useMemo(() => {
    return [...new Set([
      ...transactions.map((transaction) => normalizeSymbol(transaction.ticker)),
      ...(parsed?.rows.map((row) => row.ticker) ?? []),
    ])].filter(Boolean).sort();
  }, [parsed?.rows, transactions]);

  const previouslyImportedEtfSymbols = useMemo(() => new Set(
    transactions
      .filter((transaction) => transaction.import_source === 'schwab')
      .map((transaction) => normalizeSymbol(transaction.ticker)),
  ), [transactions]);

  const confirmedEtfSymbols = useMemo(() => new Set(
    symbolUniverse.filter((ticker) =>
      classifications[ticker] === 'etf' || manualEtfs.has(ticker)),
  ), [classifications, manualEtfs, symbolUniverse]);

  const selectedRows = useMemo(() => (parsed?.rows ?? [])
    .filter((row) => confirmedEtfSymbols.has(row.ticker))
    .map((row) => ({ ...row, kind: kinds[row.import_key] ?? row.kind })),
  [confirmedEtfSymbols, kinds, parsed?.rows]);

  const diff = useMemo(() => buildSchwabImportDiff(
    selectedRows,
    transactions,
    mode,
  ), [mode, selectedRows, transactions]);
  const depositDiff = useMemo(() => buildSchwabDepositImportDiff(
    parsed?.deposits ?? [],
    cashflows,
    mode,
  ), [cashflows, mode, parsed?.deposits]);

  const ignoredCount = (parsed?.ignored.length ?? 0)
    + (parsed?.rows.length ?? 0) - selectedRows.length;
  const canImport = !!parsed
    && parsed.errors.length === 0
    && (selectedRows.length > 0 || parsed.deposits.length > 0)
    && !classifying
    && !cashflowsLoading
    && !cashflowsError
    && !importing
    && (mode === 'append' || resetCoverageConfirmed);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    resetImportState();
    const classificationRun = classificationRunRef.current;
    setFileInfo({ name: file.name, size: file.size });
    if (file.size > MAX_FILE_BYTES) {
      setError('文件超过 5 MB，未读取。');
      return;
    }

    try {
      const nextParsed = parseSchwabTransactions(await file.text());
      setParsed(nextParsed);
      setKinds(Object.fromEntries(nextParsed.rows.map((row) => [row.import_key, 'dca'])));
      const descriptions = new Map(allSymbolDescriptions);
      for (const transaction of transactions) {
        if (transaction.source_description) {
          descriptions.set(normalizeSymbol(transaction.ticker), transaction.source_description);
        }
      }
      for (const row of nextParsed.rows) {
        if (row.source_description) descriptions.set(row.ticker, row.source_description);
      }
      const symbols = [...new Set([
        ...transactions.map((transaction) => normalizeSymbol(transaction.ticker)),
        ...nextParsed.rows.map((row) => row.ticker),
      ])].filter(Boolean);
      setClassifying(true);
      const resolved = await resolveClassifications(
        symbols,
        descriptions,
        previouslyImportedEtfSymbols,
      );
      if (classificationRun === classificationRunRef.current) {
        setClassifications(resolved);
      }
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : '文件读取失败。');
    } finally {
      if (classificationRun === classificationRunRef.current) {
        setClassifying(false);
      }
    }
  }

  function resetImportState() {
    classificationRunRef.current += 1;
    setFileInfo(null);
    setParsed(null);
    setClassifications({});
    setManualEtfs(new Set());
    setKinds({});
    setResetCoverageConfirmed(false);
    setConfirmingReset(false);
    setResult(null);
    setError(null);
    setNotice(null);
  }

  function setBulkKind(kind: SchwabImportKind) {
    setKinds((current) => ({
      ...current,
      ...Object.fromEntries(diff.added.map((row) => [row.import_key, kind])),
    }));
  }

  async function runImport() {
    if (!canImport) return;
    if (LOCAL_MODE) {
      setError('本地演示模式不写入数据库。');
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const payload = selectedRows.map((row) => ({
        source_index: row.source_index,
        trade_date: row.trade_date,
        side: row.side,
        ticker: row.ticker,
        source_description: row.source_description,
        shares: row.shares,
        price: row.price,
        fees_usd: row.fees_usd,
        amount: row.amount,
        duplicate_ordinal: row.duplicate_ordinal,
        kind: row.kind,
      }));
      const response = await supabase.rpc('import_schwab_transactions', {
        p_rows: payload,
        p_cashflows: parsed.deposits.map((row) => ({
          source_index: row.source_index,
          deposit_date: row.deposit_date,
          source_action: row.source_action,
          source_description: row.source_description,
          amount: row.amount,
          duplicate_ordinal: row.duplicate_ordinal,
        })),
        p_etf_symbols: [...confirmedEtfSymbols],
        p_mode: mode,
      });
      if (response.error) throw response.error;
      const nextResult = response.data as SchwabTransactionImportResult | null;
      if (!nextResult) throw new Error('数据库未返回导入结果。');
      setResult(nextResult);
      setConfirmingReset(false);
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
      setError(importError instanceof Error ? importError.message : '导入失败，原交易未改变。');
    } finally {
      setImporting(false);
    }
  }

  async function runExport() {
    if (exporting) return;
    setExporting(true);
    setNotice(null);
    setError(null);
    try {
      if (cashflowsLoading) {
        setNotice('正在读取入金记录，请稍后再导出。');
        return;
      }
      if (cashflowsError) {
        throw new Error('入金记录读取失败，已阻止导出不完整文件。');
      }
      const descriptions = new Map<string, string>();
      for (const transaction of transactions) {
        if (transaction.source_description) {
          descriptions.set(normalizeSymbol(transaction.ticker), transaction.source_description);
        }
      }
      const symbols = [...new Set(transactions.map((transaction) => normalizeSymbol(transaction.ticker)))];
      const resolved = await resolveClassifications(
        symbols,
        descriptions,
        previouslyImportedEtfSymbols,
      );
      const etfSymbols = new Set(symbols.filter((symbol) => resolved[symbol] === 'etf'));
      const exportRows = [...transactions]
        .filter((transaction) =>
          (transaction.side === 'buy' || transaction.side === 'sell')
          && etfSymbols.has(normalizeSymbol(transaction.ticker)))
      const exportDeposits = cashflows.filter((cashflow) =>
        cashflow.import_source === 'schwab'
        && !!cashflow.usd_in_date
        && Number(cashflow.usd_amount) > 0
        && !!cashflow.source_action
        && isSchwabDepositAction(cashflow.source_action));
      if (exportRows.length === 0 && exportDeposits.length === 0) {
        setNotice('没有可导出的 ETF 交易或嘉信入金。');
        return;
      }

      const content = exportSchwabTransactions(
        exportRows,
        exportDeposits.map((cashflow) => ({
          id: cashflow.id,
          created_at: cashflow.created_at,
          usd_in_date: cashflow.usd_in_date!,
          usd_amount: cashflow.usd_amount!,
          source_action: cashflow.source_action!,
          source_description: cashflow.source_description,
        })),
      );
      downloadTextFile(content, `Schwab_Transactions_${fileTimestamp(new Date())}.csv`);
      const unknownCount = symbols.filter((symbol) => resolved[symbol] === 'unknown').length;
      setNotice(
        `已导出 ${exportRows.length} 笔 ETF 交易、${exportDeposits.length} 笔入金`
        + (unknownCount > 0 ? `；${unknownCount} 个无法确认的代码未导出。` : '。'),
      );
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '导出失败。');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="flex max-w-full flex-col items-end gap-1">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="导入嘉信交易文件"
            onClick={() => {
              setOpen(true);
              setNotice(null);
            }}
          >
            <Upload className="h-4 w-4" />
            导入
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="导出 ETF 交易与嘉信入金文件"
            disabled={exporting || cashflowsLoading || (transactions.length === 0 && cashflows.length === 0)}
            onClick={() => void runExport()}
          >
            <Download className="h-4 w-4" />
            {exporting ? '识别中…' : '导出'}
          </Button>
        </div>
        {(notice || (!open && error)) && (
          <p className={`max-w-sm text-right text-[11px] ${error ? 'text-loss' : 'text-muted-foreground'}`}>
            {error ?? notice}
          </p>
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setConfirmingReset(false);
            setError(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl min-w-0 overflow-x-hidden">
          {confirmingReset ? (
            <ResetConfirmation
              transactionAdded={diff.added.length}
              transactionRemoved={diff.removed.length}
              cashflowAdded={depositDiff.added.length}
              cashflowRemoved={depositDiff.removed.length}
              importing={importing}
              error={error}
              onBack={() => setConfirmingReset(false)}
              onConfirm={() => void runImport()}
            />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>导入嘉信 ETF 交易与入金</DialogTitle>
                <DialogDescription>
                  文件只在此设备解析；仅标准化后的 ETF 买卖与正向入账会发送到数据库。
                </DialogDescription>
              </DialogHeader>

              {result ? (
                <ImportResult result={result} onReset={() => {
                  resetImportState();
                  if (inputRef.current) inputRef.current.value = '';
                  inputRef.current?.click();
                }} />
              ) : (
                <div className="min-w-0 space-y-5">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="schwab-file">嘉信交易文件</Label>
                    <input
                      ref={inputRef}
                      id="schwab-file"
                      type="file"
                      className="sr-only"
                      accept=".csv,text/csv,text/tab-separated-values"
                      aria-describedby="schwab-file-help"
                      onChange={(event) => void handleFileChange(event)}
                    />
                    <label
                      htmlFor="schwab-file"
                      className="group flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent/50 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors group-hover:text-foreground">
                        <FileSpreadsheet className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {fileInfo?.name ?? '选择嘉信交易文件'}
                        </span>
                        <span id="schwab-file-help" className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {fileInfo
                            ? `${formatBytes(fileInfo.size)} · ${parsed?.delimiter === '\t' ? 'Tab 分隔' : parsed?.delimiter === ',' ? '逗号分隔' : '正在识别格式'}`
                            : '支持 CSV 或 Tab 分隔文件，最大 5 MB'}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-primary">
                        <Upload className="h-4 w-4" />
                        <span className="hidden sm:inline">{fileInfo ? '更换' : '选择'}</span>
                      </span>
                    </label>
                  </div>

                  {parsed && (
                    <>
                      <div className="space-y-2 border-t border-border pt-4">
                        <Label>导入方式</Label>
                        <SegmentedControl
                          value={mode}
                          onChange={(nextMode) => {
                            setMode(nextMode);
                            setResetCoverageConfirmed(false);
                          }}
                          name="schwab-import-mode"
                          ariaLabel="新增导入或清空全部后导入"
                          className="w-full sm:w-auto"
                          options={[
                            { value: 'append', label: '新增导入' },
                            { value: 'reset_all', label: '清空全部后导入' },
                          ]}
                        />
                      </div>

                      <div className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-6">
                        <DiffMetric label="ETF" value={selectedRows.length} />
                        <DiffMetric label="入金" value={parsed.deposits.length} />
                        <DiffMetric label="忽略" value={ignoredCount} />
                        <DiffMetric
                          label="交易 / 入金未变"
                          value={`${diff.unchanged.length} / ${depositDiff.unchanged.length}`}
                        />
                        <DiffMetric label={mode === 'reset_all' ? '交易 + / −' : '交易新增'} value={
                          mode === 'reset_all'
                            ? `${diff.added.length} / ${diff.removed.length}`
                            : diff.added.length
                        } />
                        <DiffMetric label={mode === 'reset_all' ? '入金 + / −' : '入金新增'} value={
                          mode === 'reset_all'
                            ? `${depositDiff.added.length} / ${depositDiff.removed.length}`
                            : depositDiff.added.length
                        } />
                      </div>

                      <SymbolReview
                        symbols={symbolUniverse}
                        descriptions={allSymbolDescriptions}
                        classifications={classifications}
                        manualEtfs={manualEtfs}
                        classifying={classifying}
                        onToggle={(ticker, checked) => {
                          setManualEtfs((current) => {
                            const next = new Set(current);
                            if (checked) next.add(ticker);
                            else next.delete(ticker);
                            return next;
                          });
                        }}
                      />

                      {parsed.deposits.length > 0 && <DepositReview rows={parsed.deposits} />}

                      {diff.added.length > 0 && (
                        <KindReview
                          rows={diff.added}
                          kinds={kinds}
                          onBulk={setBulkKind}
                          onChange={(key, kind) => setKinds((current) => ({ ...current, [key]: kind }))}
                        />
                      )}

                      {mode === 'reset_all' && (
                        <label
                          className={cn(
                            'group flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm transition-colors',
                            resetCoverageConfirmed
                              ? 'border-warn/50 bg-warn-soft'
                              : 'border-border bg-surface-elevated hover:border-warn/40 hover:bg-warn-soft/50',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={resetCoverageConfirmed}
                            onChange={(event) => setResetCoverageConfirmed(event.target.checked)}
                          />
                          <span
                            aria-hidden="true"
                            className={cn(
                              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
                              resetCoverageConfirmed
                                ? 'border-warn bg-warn text-white'
                                : 'border-input bg-background group-hover:border-warn/60',
                            )}
                          >
                            {resetCoverageConfirmed && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                          </span>
                          <span className="min-w-0">
                            <span className="block font-medium">
                              {resetCoverageConfirmed ? '已确认清空全部组合数据' : '确认清空全部组合数据'}
                            </span>
                            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                              全部交易、全部现金流和资金批次将先清除，再按文件重建已确认的 ETF 交易与正向入金。
                            </span>
                          </span>
                        </label>
                      )}

                      {parsed.errors.length > 0 && (
                        <div className="rounded-lg border border-loss/30 bg-loss-soft px-3 py-2 text-xs text-loss">
                          <p className="font-medium">发现 {parsed.errors.length} 个错误，导入已阻止</p>
                          {parsed.errors.slice(0, 6).map((parseError, index) => (
                            <p key={`${parseError.sourceIndex ?? 'file'}-${index}`} className="mt-1">
                              {parseError.message}
                            </p>
                          ))}
                        </div>
                      )}
                      {cashflowsError && (
                        <p className="text-xs text-loss">现有入金读取失败，已阻止导入以避免重复记录。</p>
                      )}
                    </>
                  )}

                  {error && <p className="text-xs text-loss">{error}</p>}

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setOpen(false)}>取消</Button>
                    <Button
                      type="button"
                      disabled={!canImport}
                      onClick={() => {
                        if (mode === 'reset_all') setConfirmingReset(true);
                        else void runImport();
                      }}
                    >
                      {classifying ? '识别 ETF 中…' : mode === 'reset_all' ? '继续确认' : '导入新增记录'}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SymbolReview({
  symbols,
  descriptions,
  classifications,
  manualEtfs,
  classifying,
  onToggle,
}: {
  symbols: string[];
  descriptions: Map<string, string>;
  classifications: Record<string, SchwabSymbolClassification>;
  manualEtfs: Set<string>;
  classifying: boolean;
  onToggle: (ticker: string, checked: boolean) => void;
}) {
  if (symbols.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <Label>ETF 识别</Label>
        <span className="text-[11px] text-muted-foreground">
          {classifying ? '正在核对代码…' : '未知代码默认忽略'}
        </span>
      </div>
      <div className="max-h-40 min-w-0 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {symbols.map((ticker) => {
          const classification = classifications[ticker] ?? 'unknown';
          const isEtf = classification === 'etf' || manualEtfs.has(ticker);
          const isStock = classification === 'stock';
          return (
            <label
              key={ticker}
              className="grid min-w-0 grid-cols-[auto_3.5rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-xs"
            >
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-primary"
                checked={isEtf}
                disabled={classification === 'etf' || isStock || classifying}
                onChange={(event) => onToggle(ticker, event.target.checked)}
              />
              <span className="font-semibold">{ticker}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {descriptions.get(ticker) || '无证券描述'}
              </span>
              <span className={isStock ? 'text-loss' : isEtf ? 'text-gain' : 'text-warn'}>
                {isStock ? '个股 · 忽略' : isEtf ? 'ETF' : '待确认'}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function KindReview({
  rows,
  kinds,
  onBulk,
  onChange,
}: {
  rows: SchwabImportRow[];
  kinds: Record<string, SchwabImportKind>;
  onBulk: (kind: SchwabImportKind) => void;
  onChange: (key: string, kind: SchwabImportKind) => void;
}) {
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>新增交易类型</Label>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onBulk('dca')}>
            全部月定投
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onBulk('lumpsum')}>
            全部大额建仓
          </Button>
        </div>
      </div>
      <div className="max-h-44 min-w-0 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {rows.map((row) => (
          <div
            key={row.import_key}
            className="grid min-w-0 grid-cols-[5rem_3.5rem_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-xs sm:grid-cols-[5rem_3.5rem_minmax(0,1fr)_auto]"
          >
            <span className="tnum">{row.trade_date}</span>
            <span className="font-semibold">{row.ticker}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground tnum">
              {row.side === 'buy' ? '买入' : '卖出'} {row.shares} 股
            </span>
            <select
              aria-label={`${row.trade_date} ${row.ticker} 交易类型`}
              className="col-span-3 h-8 min-w-0 rounded-md border border-input bg-background px-2 sm:col-span-1"
              value={kinds[row.import_key] ?? 'dca'}
              onChange={(event) => onChange(row.import_key, event.target.value as SchwabImportKind)}
            >
              <option value="dca">月定投</option>
              <option value="lumpsum">大额建仓</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function DepositReview({ rows }: { rows: SchwabDepositImportRow[] }) {
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <Label>识别到的入金</Label>
      <div className="max-h-36 min-w-0 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {rows.map((row) => (
          <div
            key={row.import_key}
            className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-xs"
          >
            <span className="tnum">{row.deposit_date}</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {row.source_action}{row.source_description ? ` · ${row.source_description}` : ''}
            </span>
            <span className="font-semibold tnum">${row.amount.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-background px-3 py-2 text-center">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold tnum">{value}</p>
    </div>
  );
}

function ResetConfirmation({
  transactionAdded,
  transactionRemoved,
  cashflowAdded,
  cashflowRemoved,
  importing,
  error,
  onBack,
  onConfirm,
}: {
  transactionAdded: number;
  transactionRemoved: number;
  cashflowAdded: number;
  cashflowRemoved: number;
  importing: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>确认清空全部组合数据并导入</DialogTitle>
        <DialogDescription>
          全部交易将删除 {transactionRemoved} 笔，并从文件重建 {transactionAdded} 笔已确认的 ETF 交易；
          全部现金流将删除 {cashflowRemoved} 笔，并从文件重建 {cashflowAdded} 笔正向入金。
        </DialogDescription>
      </DialogHeader>
      <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-3 text-sm">
        个股交易、手工现金流和资金批次也会删除。设置、分享链接、行情与日线价格不受影响；
        任何错误都会回滚整批清空和写入。
      </div>
      {error && <p className="text-xs text-loss">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={importing} onClick={onBack}>返回检查</Button>
        <Button type="button" variant="destructive" disabled={importing} onClick={onConfirm}>
          <RotateCcw className="h-4 w-4" />
          {importing ? '正在清空并导入…' : '确认清空并导入'}
        </Button>
      </div>
    </>
  );
}

function ImportResult({
  result,
  onReset,
}: {
  result: SchwabTransactionImportResult;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5">
        <DiffMetric label="交易 新 / 留 / 移" value={
          `${result.transactions_added} / ${result.transactions_unchanged} / ${result.transactions_removed}`
        } />
        <DiffMetric label="入金 新 / 留 / 移" value={
          `${result.cashflows_added} / ${result.cashflows_unchanged} / ${result.cashflows_removed}`
        } />
        <DiffMetric label="批次移除" value={result.funding_batches_removed} />
        <DiffMetric label="合计变化" value={result.added + result.removed} />
        <DiffMetric label="错误" value={result.errors} />
      </div>
      <p className="text-sm text-muted-foreground">
        交易、入金、现金余额和业绩缓存状态已刷新。新增 ETF 的日线价格可在“数据健康”中补齐。
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" asChild>
          <Link to="/health">打开数据健康</Link>
        </Button>
        <Button type="button" onClick={onReset}>继续读取文件</Button>
      </div>
    </div>
  );
}

async function resolveClassifications(
  symbols: string[],
  descriptions: Map<string, string>,
  previouslyImportedEtfSymbols: ReadonlySet<string>,
): Promise<Record<string, SchwabSymbolClassification>> {
  const knownEtfSymbols = new Set([...KNOWN_ETF_SYMBOLS, ...previouslyImportedEtfSymbols]);
  const pairs = await Promise.all(symbols.map(async (rawTicker) => {
    const ticker = normalizeSymbol(rawTicker);
    const local = classifySchwabSymbol({
      ticker,
      description: descriptions.get(ticker),
      knownEtfSymbols,
    });
    if (local !== 'unknown') return [ticker, local] as const;

    try {
      const results = await searchSymbols(ticker);
      const exact = results.find((row) => normalizeSymbol(row.symbol) === ticker);
      return [ticker, classifySchwabSymbol({
        ticker,
        description: descriptions.get(ticker),
        knownEtfSymbols,
        providerType: exact?.type,
      })] as const;
    } catch {
      return [ticker, 'unknown'] as const;
    }
  }));
  return Object.fromEntries(pairs);
}

function downloadTextFile(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fileTimestamp(date: Date): string {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');
  const time = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${parts}-${time}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
