import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSettings } from '@/hooks/usePortfolio';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { DEFAULT_BENCHMARKS, DEFAULT_WATCHLIST, getBenchmarks, getSelectedBenchmark, splitTickers } from '@/lib/settings';
import { backfillTrackedSymbols, registerTrackedSymbols } from '@/lib/trackedSymbols';
import { normalizeSymbol } from '@/lib/symbols';
import { LOCAL_MODE } from '@/lib/localMode';

export interface SettingsFormValues {
  target_usd: string;
  expected_annual_ret: string;
  monthly_dca_usd: string;
  email_enabled: boolean;
  email_to: string;
  cost_basis_default: 'avg' | 'fifo';
  watchlist: string;
  benchmarks: string;
  selected_benchmark: string;
}

const EMPTY_FORM: SettingsFormValues = {
  target_usd: '1000000',
  expected_annual_ret: '8',
  monthly_dca_usd: '',
  email_enabled: true,
  email_to: '',
  cost_basis_default: 'avg',
  watchlist: 'VOO,QQQM,SMH',
  benchmarks: DEFAULT_BENCHMARKS.join(','),
  selected_benchmark: DEFAULT_BENCHMARKS[0],
};

interface SettingsFormContextValue {
  form: SettingsFormValues;
  setForm: (update: (previous: SettingsFormValues) => SettingsFormValues) => void;
  /** True while the loaded row and the edited form differ, in any pane. */
  dirty: boolean;
  saving: boolean;
  savedFlash: boolean;
  save: () => void;
}

const SettingsFormContext = createContext<SettingsFormContextValue | null>(null);

/**
 * One settings row backs three panes, so the edit state lives above them.
 * Each pane keeps its own save action — the reference gives every card its own
 * primary action — but a save always writes the whole row, which is why
 * switching panes never drops a pending edit.
 */
export function SettingsFormProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const [form, setForm] = useState<SettingsFormValues>(EMPTY_FORM);
  const [savedFlash, setSavedFlash] = useState(false);

  const loaded = useMemo<SettingsFormValues | null>(() => {
    if (!settings) return null;
    return {
      target_usd: String(settings.target_usd),
      expected_annual_ret: String(Number(settings.expected_annual_ret) * 100),
      monthly_dca_usd: settings.monthly_dca_usd ? String(settings.monthly_dca_usd) : '',
      email_enabled: settings.email_enabled,
      email_to: settings.email_to ?? '',
      cost_basis_default: (settings.cost_basis_default as 'avg' | 'fifo') ?? 'avg',
      watchlist: (settings.watchlist ?? DEFAULT_WATCHLIST).join(','),
      benchmarks: getBenchmarks(settings).join(','),
      selected_benchmark: getSelectedBenchmark(settings),
    };
  }, [settings]);

  useEffect(() => {
    if (loaded) setForm(loaded);
  }, [loaded]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('not_authed');
      const watchlist = splitTickers(form.watchlist, DEFAULT_WATCHLIST);
      const benchmarks = splitTickers(form.benchmarks, DEFAULT_BENCHMARKS);
      const normalizedSelected = normalizeSymbol(form.selected_benchmark);
      const selectedBenchmark = benchmarks.includes(normalizedSelected)
        ? normalizedSelected
        : benchmarks[0] ?? 'SPY';
      const payload = {
        user_id: user.id,
        target_usd: Number(form.target_usd),
        expected_annual_ret: Number(form.expected_annual_ret) / 100,
        monthly_dca_usd: form.monthly_dca_usd ? Number(form.monthly_dca_usd) : null,
        email_enabled: form.email_enabled,
        email_to: form.email_to || null,
        cost_basis_default: form.cost_basis_default,
        watchlist,
        benchmarks,
        selected_benchmark: selectedBenchmark,
      };
      if (LOCAL_MODE) {
        qc.setQueryData(['settings'], { ...payload, updated_at: new Date().toISOString() });
        return;
      }
      const { error } = await supabase.from('settings').upsert(payload);
      if (!error) {
        const symbols = await registerTrackedSymbols([...watchlist, ...benchmarks], 'settings');
        await backfillTrackedSymbols(symbols, { limit: 10 });
        return;
      }
      if (!/benchmarks|selected_benchmark|schema cache|column/i.test(error.message ?? '')) throw error;
      const { benchmarks: _benchmarks, selected_benchmark: _selected, ...legacyPayload } = payload;
      const retry = await supabase.from('settings').upsert(legacyPayload);
      if (retry.error) throw retry.error;
      const symbols = await registerTrackedSymbols([...watchlist, ...benchmarks], 'settings');
      await backfillTrackedSymbols(symbols, { limit: 10 });
    },
    onSuccess: async () => {
      if (LOCAL_MODE) {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1500);
        return;
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['settings'] }),
        qc.invalidateQueries({ queryKey: ['tracked_symbol_coverage'] }),
        qc.invalidateQueries({ queryKey: ['price_coverage'] }),
      ]);
      await qc.refetchQueries({ queryKey: ['tracked_symbol_coverage'] });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    },
  });

  const value = useMemo<SettingsFormContextValue>(
    () => ({
      form,
      setForm,
      dirty: loaded !== null && JSON.stringify(loaded) !== JSON.stringify(form),
      saving: save.isPending,
      savedFlash,
      save: () => save.mutate(),
    }),
    // `save` is a stable-enough mutation object; only its pending flag matters here.
    [form, loaded, save.isPending, savedFlash],
  );

  return <SettingsFormContext.Provider value={value}>{children}</SettingsFormContext.Provider>;
}

export function useSettingsForm(): SettingsFormContextValue {
  const value = useContext(SettingsFormContext);
  if (!value) throw new Error('useSettingsForm must be used inside SettingsFormProvider');
  return value;
}
