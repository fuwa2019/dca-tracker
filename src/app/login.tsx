import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, ArrowRight, ArrowLeft, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sendOtp, verifyEmailOtp } from '@/hooks/useAuth';

type Step = 'email' | 'code';

export function LoginPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'code') {
      // Autofocus the code field when we land here
      const t = setTimeout(() => codeInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [step]);

  async function handleSendEmail(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setError('');
    setSending(true);
    try {
      const { error } = await sendOtp(email);
      if (error) throw error;
      setStep('code');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.replace(/\D/g, '').slice(0, 6);
    if (trimmed.length !== 6) {
      setError('请输入完整的 6 位验证码');
      return;
    }
    setError('');
    setVerifying(true);
    try {
      const { error } = await verifyEmailOtp(email, trimmed);
      if (error) throw error;
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '验证失败，可能是验证码错误或已过期');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 22, stiffness: 200 }}
        className="w-full max-w-sm space-y-6"
      >
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-xl font-bold">
            $
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">DCA Tracker</h1>
          <p className="text-sm text-muted-foreground">
            {step === 'email' ? '输入邮箱，下一步会收到 6 位验证码' : '请输入邮件里的 6 位验证码'}
          </p>
        </div>

        <AnimatePresence mode="wait">
          {step === 'email' ? (
            <motion.form
              key="email"
              onSubmit={handleSendEmail}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={sending}>
                {sending ? '发送中…' : (<>发送验证码 <ArrowRight className="h-4 w-4" /></>)}
              </Button>
            </motion.form>
          ) : (
            <motion.form
              key="code"
              onSubmit={handleVerify}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-3"
            >
              <div className="flex items-center gap-2 rounded-lg border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">已发送到 <strong className="text-foreground">{email}</strong></span>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="code">验证码</Label>
                <Input
                  ref={codeInputRef}
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="text-center text-2xl tracking-[0.4em] tnum"
                  required
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={verifying || code.length !== 6}>
                {verifying ? '验证中…' : (<><KeyRound className="h-4 w-4" /> 验证并登录</>)}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setCode('');
                  setError('');
                  setStep('email');
                }}
              >
                <ArrowLeft className="h-4 w-4" /> 换邮箱
              </Button>
            </motion.form>
          )}
        </AnimatePresence>

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-xs text-danger"
          >
            {error}
          </motion.p>
        )}

        <p className="text-center text-xs text-muted-foreground">
          只读分享视图无需登录 — 直接访问 <code className="font-mono">/share/&lt;token&gt;</code>
        </p>
      </motion.div>
    </div>
  );
}
