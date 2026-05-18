import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Mail, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signInWithMagicLink } from '@/hooks/useAuth';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus('sending');
    try {
      const { error } = await signInWithMagicLink(email, `${window.location.origin}/`);
      if (error) throw error;
      setStatus('sent');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : '发送失败');
      setStatus('error');
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
          <p className="text-sm text-muted-foreground">输入邮箱，发送一次性登录链接</p>
        </div>

        {status === 'sent' ? (
          <div className="rounded-2xl border bg-card p-5 text-center text-sm">
            <Mail className="mx-auto mb-2 h-6 w-6 text-success" />
            <p>登录链接已发送到 <span className="font-medium">{email}</span></p>
            <p className="mt-1 text-xs text-muted-foreground">检查收件箱（包括垃圾邮件），点击链接即可登录。</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={status === 'sending'}>
              {status === 'sending' ? '发送中…' : (<>发送登录链接 <ArrowRight className="h-4 w-4" /></>)}
            </Button>
            {status === 'error' && <p className="text-center text-xs text-danger">{errorMsg}</p>}
          </form>
        )}

        <p className="text-center text-xs text-muted-foreground">
          只读分享视图无需登录 — 直接访问 <code className="font-mono">/share/&lt;token&gt;</code>
        </p>
      </motion.div>
    </div>
  );
}
